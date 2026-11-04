import {
    BelongsToGetAssociationMixin,
    DataTypes,
    FindOptions,
    HasManyGetAssociationsMixin,
    HasOneGetAssociationMixin,
    Op,
    Sequelize,
    Transaction
} from "sequelize";

import {BaseModel} from "./baseModel";
import {Annotation} from "./annotation";
import {AtlasReconstruction} from "./atlasReconstruction";
import {User} from "./user";
import {Neuron} from "./neuron";
import {Specimen} from "./specimen";
import {Injection} from "./injection";
import {InjectionVirus} from "./injectionVirus";
import {Fluorophore} from "./fluorophore";
import {Genotype} from "./genotype";
import {Collection} from "./collection";
import {mapToSpecimenNodeShape, SpecimenNode, SpecimenNodeShape} from "./specimenNode";
import {SpecimenSpacePrecomputed} from "./specimenSpacePrecomputed";
import {NeuronStructure} from "./neuronStructure";
import {NodeStructure} from "./nodeStructure";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {SpecimenSpaceReconstructionTableName} from "./tableNames";
import {SpecimenSpaceReconstructionStatus} from "./specimenSpaceReconstructionStatus";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {NodeCounts, SimpleReconstruction} from "../io/simpleReconstruction";
import {PortalAnnotationSpace, PortalNode, PortalReconstruction} from "../io/portalFormat";

const debug = require("debug")("nmcp:nmcp-api:specimen-space-reconstruction");

export type SpecimenSpaceReconstructionShape = {
    id?: string;
    status?: SpecimenSpaceReconstructionStatus;
    sourceUrl?: string;
    sourceComments?: string;
    lengthMillimeters?: number;
    nodeCounts?: NodeCounts;
    somaNodeId?: string;
    annotationId?: string;
}

export class SpecimenSpaceReconstruction extends BaseModel {
    public status: SpecimenSpaceReconstructionStatus;
    public sourceUrl: string;
    public sourceComments: string;
    public lengthMillimeters: number;
    public nodeCounts: NodeCounts;
    public somaNodeId: string;
    public annotationId: string;

    public getAnnotation!: BelongsToGetAssociationMixin<Annotation>;
    public getSoma!: BelongsToGetAssociationMixin<SpecimenNode>;
    public getSpecimenNodes!: HasManyGetAssociationsMixin<SpecimenNode>;
    public getPrecomputed!: HasOneGetAssociationMixin<SpecimenSpacePrecomputed>;

    public Annotation?: Annotation;
    public Soma?: SpecimenNode;
    public Precomputed?: SpecimenSpacePrecomputed;

    private async recordEvent(kind: EventLogItemKind, details: object, user: User, transaction: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.annotationId,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, transaction);
    }

    private static async createWithTransaction(user: User, shape: SpecimenSpaceReconstructionShape, transaction: Transaction, substituteUser: User = null): Promise<SpecimenSpaceReconstruction> {
        const specimenSpaceReconstruction = await this.create(shape, {transaction});

        await specimenSpaceReconstruction.recordEvent(EventLogItemKind.SpecimenSpaceReconstructionCreate, shape, user, transaction, substituteUser);

        return specimenSpaceReconstruction;
    }

    public static async createForShape(user: User, shape: SpecimenSpaceReconstructionShape, transaction: Transaction = null, substituteUser: User = null): Promise<SpecimenSpaceReconstruction> {
        if (transaction === null) {
            return await this.sequelize.transaction(async (ownTransaction) => {
                return await this.createWithTransaction(user, shape, ownTransaction, substituteUser);
            });
        } else {
            return await this.createWithTransaction(user, shape, transaction, substituteUser);
        }
    }

    public async replaceNodeData(user: User, reconstructionData: SimpleReconstruction, transaction: Transaction): Promise<SpecimenSpaceReconstruction> {
        await this.update({somaNodeId: null}, {transaction});

        await SpecimenNode.destroy({
            where: {reconstructionId: this.id},
            transaction
        });

        for (const structure of [reconstructionData.axon, reconstructionData.dendrite]) {
            const nodeData: SpecimenNodeShape[] = structure.getNonSomaNodes().map(node => mapToSpecimenNodeShape(node, structure.NeuronStructureId, this.id));

            const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

            for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                await SpecimenNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction});
            }
        }

        const somaShape = mapToSpecimenNodeShape(reconstructionData.axon.soma, NeuronStructure.SomaNeuronStructureId, this.id);

        const soma = await SpecimenNode.create(somaShape, {transaction});

        const updated = await this.update({
            sourceUrl: reconstructionData.source,
            sourceComments: reconstructionData.comments,
            nodeCounts: {axon: reconstructionData.axon.nodeCounts, dendrite: reconstructionData.dendrite.nodeCounts},
            somaNodeId: soma?.id
        }, {transaction});

        await this.recordEvent(EventLogItemKind.SpecimenSpaceReconstructionUpload, null, user, transaction);

        return updated;
    }

    public async copyFrom(source: SpecimenSpaceReconstruction, user: User, transaction: Transaction): Promise<void> {
        const nodes = await SpecimenNode.findAll({
            where: {
                reconstructionId: source.id
            },
            transaction
        });

        const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

        for (let idx = 0; idx < nodes.length; idx += chunkSize) {
            const nodeData = nodes.slice(idx, idx + chunkSize).map(node => {
                const obj = node.toJSON();
                obj.id = undefined;
                obj.reconstructionId = this.id;
                return obj;
            });

            await SpecimenNode.bulkCreate(nodeData, {transaction});
        }

        const soma = await SpecimenNode.findOne({
            where: {
                reconstructionId: this.id,
                index: 1
            },
            transaction
        });

        await this.update({
            sourceUrl: source.sourceUrl,
            sourceComments: source.sourceComments,
            lengthMillimeters: source.lengthMillimeters,
            nodeCounts: source.nodeCounts,
            somaNodeId: soma?.id
        }, {transaction});

        const precomputed = await SpecimenSpacePrecomputed.createForReconstruction(user, this.id, transaction);

        await precomputed.requestGeneration(user, transaction);
    }

    public static async discardForAnnotation(annotationId: string, transaction: Transaction): Promise<void> {
        const rows = await this.findAll({where: {annotationId}, attributes: ["id"], transaction});

        if (rows.length == 0) {
            return;
        }

        const ids = rows.map(row => row.id);

        await SpecimenNode.destroy({where: {reconstructionId: {[Op.in]: ids}}, transaction});

        await this.destroy({where: {id: {[Op.in]: ids}}, transaction});
    }

    public static async toPortalFormat(user: User, id: string): Promise<PortalReconstruction> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const include: any[] = [{
            model: Annotation,
            include: [{
                model: User,
                as: "Annotator"
            }, {
                model: User,
                as: "Reviewer"
            }, {
                model: User,
                as: "TeamReviewer"
            }, {
                model: Neuron,
                as: "Neuron",
                include: [{
                    model: Specimen,
                    as: "Specimen",
                    include: [{
                        model: Injection,
                        include: [{
                            model: InjectionVirus,
                        }, {
                            model: Fluorophore,
                        }]
                    }, {
                        model: Genotype,
                    }, {
                        model: Collection,
                    }]
                }]
            }]
        }];

        // The precomputed worker holds a specimen-space id; other callers hold an annotation id, and the export service
        // only an atlas id.
        let row = await this.findByPk(id, {include});

        if (row) {
            debug(`toPortalFormat found specimen-space reconstruction ${id}`);
        } else {
            row = await this.findOne({where: {annotationId: id}, include});

            if (row) {
                debug(`toPortalFormat found annotation ${id}`);
            } else {
                const atlas = await AtlasReconstruction.findByPk(id);

                if (atlas) {
                    debug(`toPortalFormat found atlas reconstruction ${id}`);

                    row = await this.findOne({where: {annotationId: atlas.annotationId}, include});
                }
            }
        }

        if (!row) {
            debug(`toPortalFormat ${id} not found as specimen-space reconstruction, annotation or atlas reconstruction`);
            return null;
        }

        const nodes = await this.serializeNodes(user, row.id);

        const annotation = row.Annotation;

        return {
            id: row.id,
            annotationSpace: PortalAnnotationSpace.Specimen,
            doi: annotation.doi || null,
            publishedAt: annotation.publishedAt ?? null,
            neuron: annotation.Neuron.toPortalFormat(),
            annotator: annotation.Annotator?.toPortalFormat() ?? null,
            peerReviewer: annotation.Reviewer?.toPortalFormat() ?? null,
            teamReviewer: annotation.TeamReviewer?.toPortalFormat() ?? null,
            proofreader: null,
            nodes: nodes
        }
    }

    public static async serializeNodes(user: User, reconstructionId: string): Promise<PortalNode[]> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const options: FindOptions = {
            where: {reconstructionId: reconstructionId},
            include: [{
                model: NodeStructure,
            }],
            order: [["index", "ASC"]]
        };

        const nodes = await SpecimenNode.findAll(options);

        return nodes.map(node => {
            return {
                index: node.index,
                structure: NeuronStructure.swcStructureValue(node.neuronStructureId),
                x: node.x,
                y: node.y,
                z: node.z,
                radius: node.radius,
                parentIndex: node.parentIndex,
            }
        });
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return SpecimenSpaceReconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        status: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: SpecimenSpaceReconstructionStatus.Initialized
        },
        sourceUrl: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        sourceComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        lengthMillimeters: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        nodeCounts: {
            type: DataTypes.JSONB,
            defaultValue: null
        }
    }, {
        tableName: SpecimenSpaceReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    SpecimenSpaceReconstruction.belongsTo(Annotation, {foreignKey: "annotationId"});
    SpecimenSpaceReconstruction.belongsTo(SpecimenNode, {foreignKey: "somaNodeId", as: "Soma"});
    SpecimenSpaceReconstruction.hasMany(SpecimenNode, {foreignKey: "reconstructionId"});
    SpecimenSpaceReconstruction.hasOne(SpecimenSpacePrecomputed, {foreignKey: "reconstructionId", as: "Precomputed"});
};
