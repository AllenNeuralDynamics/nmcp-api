import {
    BelongsToGetAssociationMixin,
    DataTypes,
    FindOptions,
    HasManyGetAssociationsMixin,
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
import {mapToSpecimenNodeShape, SpecimenNodeShape} from "./specimenNode";
import {RawReconstructionNode} from "./rawReconstructionNode";
import {NeuronStructure} from "./neuronStructure";
import {NodeStructure} from "./nodeStructure";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {RawReconstructionTableName} from "./tableNames";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {NodeCounts, SimpleReconstruction} from "../io/simpleReconstruction";
import {PortalAnnotationSpace, PortalNode, PortalReconstruction} from "../io/portalFormat";

const debug = require("debug")("nmcp:nmcp-api:raw-reconstruction");

export type RawReconstructionCreateShape = {
    annotationId: string;
    uploadId: string;
    notes: string;
    supersededId: string | null;
}

export class RawReconstruction extends BaseModel {
    public nodeCounts: NodeCounts;
    public notes: string;
    public uploadedAt: Date;
    public somaNodeId: string;
    public annotationId: string;

    public getAnnotation!: BelongsToGetAssociationMixin<Annotation>;
    public getSoma!: BelongsToGetAssociationMixin<RawReconstructionNode>;
    public getRawReconstructionNodes!: HasManyGetAssociationsMixin<RawReconstructionNode>;

    public Annotation?: Annotation;
    public Soma?: RawReconstructionNode;

    public static async createFromParsed(user: User, shape: RawReconstructionCreateShape, reconstructionData: SimpleReconstruction, soma: PortalNode, transaction: Transaction): Promise<RawReconstruction> {
        const raw = await this.create({
            annotationId: shape.annotationId,
            notes: shape.notes ?? "",
            uploadedAt: new Date(),
            nodeCounts: {axon: reconstructionData.axon.nodeCounts, dendrite: reconstructionData.dendrite.nodeCounts}
        }, {transaction});

        for (const structure of [reconstructionData.axon, reconstructionData.dendrite]) {
            const nodeData: SpecimenNodeShape[] = structure.getNonSomaNodes().map(node => mapToSpecimenNodeShape(node, structure.NeuronStructureId, raw.id));

            const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

            for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                await RawReconstructionNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction});
            }
        }

        const somaNode = await RawReconstructionNode.create(mapToSpecimenNodeShape(soma, NeuronStructure.SomaNeuronStructureId, raw.id), {transaction});

        await raw.update({somaNodeId: somaNode.id}, {transaction});

        await recordEvent({
            kind: EventLogItemKind.RawReconstructionCreate,
            targetId: raw.id,
            parentId: shape.annotationId,
            details: {uploadId: shape.uploadId, supersededId: shape.supersededId},
            userId: user.id
        }, transaction);

        return raw;
    }

    /**
     * Hard-deletes the annotation's current raw reconstruction so a replacement can take the unique annotationId.  A
     * superseded raw reconstruction is not kept; the upload history records that it existed.
     */
    public static async deleteForReplacement(annotationId: string, transaction: Transaction): Promise<string | null> {
        const existing = await this.findOne({where: {annotationId}, attributes: ["id"], transaction});

        if (!existing) {
            return null;
        }

        const id = existing.id;

        // The soma foreign key is NO ACTION, so the reference must go before the node it points at.
        await this.update({somaNodeId: null}, {where: {id}, transaction});

        await RawReconstructionNode.destroy({where: {reconstructionId: id}, transaction});

        await this.destroy({where: {id}, force: true, transaction});

        return id;
    }

    public static async discardForAnnotation(annotationId: string, transaction: Transaction): Promise<void> {
        const rows = await this.findAll({where: {annotationId}, attributes: ["id"], transaction});

        if (rows.length == 0) {
            return;
        }

        const ids = rows.map(row => row.id);

        // The soma foreign key is NO ACTION, so the reference must go before the node it points at.
        await this.update({somaNodeId: null}, {where: {id: {[Op.in]: ids}}, transaction});

        await RawReconstructionNode.destroy({where: {reconstructionId: {[Op.in]: ids}}, transaction});

        await this.destroy({where: {id: {[Op.in]: ids}}, transaction});
    }

    public static async copyForRevision(sourceAnnotationId: string, revisionAnnotationId: string, transaction: Transaction): Promise<RawReconstruction | null> {
        const source = await this.findOne({where: {annotationId: sourceAnnotationId}, transaction});

        if (!source) {
            return null;
        }

        const copy = await this.create({
            annotationId: revisionAnnotationId,
            nodeCounts: source.nodeCounts,
            notes: source.notes,
            uploadedAt: source.uploadedAt
        }, {transaction});

        const nodes = await RawReconstructionNode.findAll({where: {reconstructionId: source.id}, transaction});

        const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

        for (let idx = 0; idx < nodes.length; idx += chunkSize) {
            const nodeData = nodes.slice(idx, idx + chunkSize).map(node => {
                const obj = node.toJSON();
                obj.id = undefined;
                obj.reconstructionId = copy.id;
                return obj;
            });

            await RawReconstructionNode.bulkCreate(nodeData, {transaction});
        }

        const sourceSoma = nodes.find(node => node.id == source.somaNodeId);

        if (sourceSoma) {
            const soma = await RawReconstructionNode.findOne({
                where: {
                    reconstructionId: copy.id,
                    index: sourceSoma.index
                },
                transaction
            });

            if (soma) {
                await copy.update({somaNodeId: soma.id}, {transaction});
            }
        }

        return copy;
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

        let row = await this.findByPk(id, {include});

        if (row) {
            debug(`toPortalFormat found raw reconstruction ${id}`);
        } else {
            row = await this.findOne({where: {annotationId: id}, include});

            if (row) {
                debug(`toPortalFormat found annotation ${id}`);
            }
        }

        if (!row) {
            debug(`toPortalFormat ${id} not found as raw reconstruction or annotation`);
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

        const nodes = await RawReconstructionNode.findAll(options);

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
    return RawReconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        nodeCounts: {
            type: DataTypes.JSONB,
            allowNull: false
        },
        notes: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        uploadedAt: {
            type: DataTypes.DATE,
            allowNull: false
        }
    }, {
        tableName: RawReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    RawReconstruction.belongsTo(Annotation, {foreignKey: "annotationId"});
    RawReconstruction.belongsTo(RawReconstructionNode, {foreignKey: "somaNodeId", as: "Soma"});
    RawReconstruction.hasMany(RawReconstructionNode, {foreignKey: "reconstructionId"});
};
