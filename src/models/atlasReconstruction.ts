import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, Op, Sequelize, Transaction} from "sequelize";
import {uniqBy} from "lodash"

import {BaseModel} from "./baseModel";
import {Neuron} from "./neuron";
import {AtlasReconstructionStatus, PrecomputedStatusKinds, QualityControlStatusKinds} from "./atlasReconstructionStatus";
import {User} from "./user";
import {Precomputed} from "./precomputed";
import {NodeStructure, NodeStructures} from "./nodeStructure";
import {AtlasStructure} from "./atlasStructure";
import {Specimen} from "./specimen";
import {Fluorophore} from "./fluorophore";
import {InjectionVirus} from "./injectionVirus";
import {Injection} from "./injection";
import {Genotype} from "./genotype";
import {Collection} from "./collection";
import {Reconstruction} from "./reconstruction";
import {AtlasReconstructionTableName} from "./tableNames";
import {QualityControl} from "./qualityControl";
import {mapNodes, PortalJsonReconstruction, PortalJsonReconstructionContainer} from "../io/portalJson";
import {AtlasNode, AtlasNodeShape, mapToAtlasNodeShape} from "./atlasNode";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {NeuronStructure} from "./neuronStructure";
import {NodeCounts, SimpleReconstruction} from "../io/simpleReconstruction";
import {Atlas} from "./atlas";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {SearchIndexOperation} from "../transform/searchIndexOperation";
import {KDTree} from "../util/kdtree";
import {FiniteMap} from "../util/finiteMap";

const debug = require("debug")("nmcp:nmcp-api:atlas-reconstruction");

export type NearestNodeOutput = {
    reconstructionId: string;
    location: number[];
    node: AtlasNode;
    error: String;
}

export type JsonParts = {
    axonOffset?: number;
    axonLimit?: number;
    dendriteOffset?: number;
    dendriteLimit?: number;
}

const defaultJsonParts: JsonParts = {
    axonOffset: 0,
    axonLimit: null,
    dendriteOffset: 0,
    dendriteLimit: null
}

export type AtlasReconstructionShape = {
    id?: string;
    status?: AtlasReconstructionStatus;
    doi?: string;
    lengthMillimeters?: number;
    nodeStructureAssignmentAt?: Date;
    searchIndexedAt?: Date;
    reconstructionId?: string;
    reviewerId?: string;
}

export class AtlasReconstruction extends BaseModel {
    public sourceUrl: string;
    public sourceComments: string;
    public status: AtlasReconstructionStatus;
    public doi: string;
    public lengthMillimeters: number;
    public nodeCounts: NodeCounts;
    public nodeStructureAssignmentAt: Date;
    public searchIndexedAt: Date;
    public reviewerId: string;
    public reconstructionId: string;

    public getReviewer!: BelongsToGetAssociationMixin<User>;
    public getPrecomputed!: BelongsToGetAssociationMixin<Precomputed>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;
    public getQualityControl!: BelongsToGetAssociationMixin<QualityControl>;
    public getSoma!: BelongsToGetAssociationMixin<AtlasNode>;
    public getAtlasNodes!: HasManyGetAssociationsMixin<AtlasNode>;

    public readonly Precomputed: Precomputed;
    public readonly Reconstruction: Reconstruction;
    public readonly QualityControl: QualityControl;
    public readonly Reviewer: User;

    private static _nearestNodeCache: FiniteMap<string, KDTree> = new FiniteMap<string, KDTree>(10);

    private async recordEvent(kind: EventLogItemKind, details: object, user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.reconstructionId,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, t);
    }

    public static async getPendingStructureAssignment(limit: number = 10): Promise<AtlasReconstruction[]> {
        return await this.findAll({
            where: {
                status: AtlasReconstructionStatus.PendingStructureAssignment
            },
            limit: limit
        });
    }

    private static async createWithTransaction(user: User, shape: AtlasReconstructionShape, t: Transaction, substituteUser: User = null): Promise<AtlasReconstruction> {
        const reconstruction = await this.create(shape, {transaction: t});

        await reconstruction.recordEvent(EventLogItemKind.AtlasReconstructionCreate, shape, user, t, substituteUser);

        return reconstruction;
    }

    public static async createForShape(user: User, shape: AtlasReconstructionShape, t: Transaction = null, substituteUser: User = null): Promise<AtlasReconstruction> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, shape, t, substituteUser);
            })
        } else {
            return await this.createWithTransaction(user, shape, t, substituteUser);
        }
    }

    public async approve(user: User, t: Transaction, substituteUser: User = null): Promise<boolean> {
        if (!this.nodeCounts) {
            // Cannot approve until there are nodes.
            return false;
        }

        const update = {reviewerId: user.id};

        await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.AtlasReconstructionApprove, update, user, t, substituteUser);

        return await this.prepareToFinalize(user, t, substituteUser);
    }

    public async prepareToFinalize(user: User, t: Transaction, substituteUser: User = null): Promise<boolean> {
        if (!this.nodeCounts) {
            // Cannot finalize until there are nodes.
            return false;
        }

        // Set up next step: QC if needed.
        // TODO change create to only create if needed for one call.
        let qc = await QualityControl.findOne({where:{reconstructionId: this.id}});

        if (!qc) {
            await QualityControl.createForReconstruction(user, this.id, t);
        } else {
            await qc.makePending(user, t);
        }

        const qcUpdate = {status: AtlasReconstructionStatus.PendingQualityControl};

        await this.update(qcUpdate, {transaction: t});

        await this.recordEvent(EventLogItemKind.AtlasReconstructionQualityControlRequest, qcUpdate, user, t, substituteUser);

        // TODO change create to only create if needed for one call.
        // Set up Precomputed
        let precomputed = await QualityControl.findOne({where:{reconstructionId: this.id}});

        // Do not need to reset status.  Precomputed status will be set to pending after node structure assigment (after quality control)
        if (!precomputed) {
            await Precomputed.createForReconstruction(user, this.id, t);
        }

        return true;
    }

    public async reject(user: User, t: Transaction): Promise<AtlasReconstruction> {
        const update = {reviewerId: user.id};

        const r = await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.AtlasReconstructionReject, update, user, t);

        return r;
    }

    public static async discardForReconstruction(user: User, reconstructionId: string, t: Transaction): Promise<void> {
        // reconstructionId is the parent Reconstruction, not an AtlasReconstruction
        const reconstructions = await this.findAll({
            where: {
                reconstructionId: reconstructionId
            },
            attributes: ["id"]
        });

        if (reconstructions.length > 0) {
            for (const reconstruction of reconstructions) {
                await reconstruction.recordEvent(EventLogItemKind.AtlasReconstructionDiscard, null, user, t);

                await QualityControl.destroy({where: {reconstructionId: reconstruction.id}, transaction: t});
            }

            const ids = reconstructions.map(t => t.id);

            await AtlasNode.destroy({
                where: {
                    reconstructionId: {
                        [Op.in]: ids
                    }
                }, transaction: t
            });

            await this.destroy({
                where: {
                    id: {[Op.in]: ids}
                }, transaction: t
            });
        }
    }

    public async replaceNodeData(user: User, reconstructionData: SimpleReconstruction, t: Transaction): Promise<AtlasReconstruction> {
        try {
            await this.update({somaNodeId: null, transaction: t});

            await AtlasNode.destroy({
                where: {reconstructionId: this.id},
                transaction: t
            });

            for (const structure of [reconstructionData.axon, reconstructionData.dendrite]) {
                const nodeData: AtlasNodeShape[] = structure.getNonSomaNodes().map(node => mapToAtlasNodeShape(node, structure.NeuronStructureId, this.id));

                const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

                for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                    await AtlasNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction: t});
                }
            }

            const somaShape = mapToAtlasNodeShape(reconstructionData.axon.soma, NeuronStructure.SomaNeuronStructureId, this.id);

            const soma = await AtlasNode.create(somaShape, {transaction: t});

            const updated = await this.update({
                sourceUrl: reconstructionData.source,
                sourceComments: reconstructionData.comments,
                nodeCounts: {axon: reconstructionData.axon.nodeCounts, dendrite: reconstructionData.dendrite.nodeCounts},
                somaNodeId: soma?.id
            }, {transaction: t});

            await this.recordEvent(EventLogItemKind.AtlasReconstructionUpload, null, user, t);

            return updated;
        } catch (error) {
            debug(error);
            throw error;
        }
    }

    public async qualityControlChanged(passed: boolean, user: User, t: Transaction): Promise<void> {
        if (QualityControlStatusKinds.includes(this.status)) {
            await this.recordEvent(EventLogItemKind.AtlasReconstructionQualityControlComplete, {passed: passed}, user, t);

            const update = {
                status: passed ? AtlasReconstructionStatus.PendingStructureAssignment : AtlasReconstructionStatus.FailedQualityControl
            }

            await this.update(update, {transaction: t});

            const kind = passed ? EventLogItemKind.AtlasReconstructionNodeStructureAssignmentRequest : EventLogItemKind.AtlasReconstructionUpdate;

            await this.recordEvent(kind, update, user, t);

        } else {
            // TODO SystemError
            debug(`received unexpected quality control update (current status: ${this.status})`);
        }
    }

    public async calculateStructureAssignments(user: User) {
        const data = await this.getReconstruction({
            include: [{
                model: Neuron,
                as: "Neuron",
                include: [{
                    model: Specimen,
                    as: "Specimen",
                    attributes: ["atlasId"]
                }]
            }]
        });

        const atlas = Atlas.getAtlas(data.Neuron.Specimen.atlasId);

        // TODO System error, if no atlas.

        const where = {reconstructionId: this.id, manualAtlasAssigment: false};

        const count = await AtlasNode.count({where: where});

        debug(`assigning atlas structures to ${count} nodes for reconstruction ${this.id} where manual Atlas assignment is false`);

        await this.sequelize.transaction(async (t) => {
            for (let idx = 0; idx < count; idx += AtlasReconstruction.PreferredDatabaseChunkSize) {
                const nodes = await AtlasNode.findAll({
                    where: where,
                    offset: idx,
                    limit: AtlasReconstruction.PreferredDatabaseChunkSize,
                    order: [["index", "ASC"]]
                });

                const structureMap = new Map<string, string[]>();

                for (const node of nodes) {
                    const structureId = atlas.findForLocation({x: node.x, y: node.y, z: node.z}, true);
                    let list = structureMap.get(structureId);
                    if (!list) {
                        list = [];
                        structureMap.set(structureId, list);
                    }
                    list.push(node.id);
                }

                for (const [key, value] of structureMap.entries()) {
                    await AtlasNode.update({
                        atlasStructureId: key
                    }, {where: {id: {[Op.in]: value}}, transaction: t});
                }

                debug(`\tassigned ${structureMap.size} unique atlas structures to ${nodes.length} nodes`);
            }

            let update = {nodeStructureAssignmentAt: Date.now()};

            await this.update(update, {transaction: t});

            await this.recordEvent(EventLogItemKind.AtlasReconstructionNodeStructureAssignmentComplete, update, user, t);

            const statusUpdate = {status: AtlasReconstructionStatus.PendingPrecomputed};

            await this.update(statusUpdate, {transaction: t});

            const precomputed = await this.getPrecomputed();

            await precomputed.requestGeneration(user, t);

            await this.recordEvent(EventLogItemKind.AtlasReconstructionPrecomputedRequest, statusUpdate, user, t);
        });
    }

    public async precomputedChanged(user: User, complete: boolean, t: Transaction): Promise<void> {
        if (PrecomputedStatusKinds.includes(this.status)) {
            await this.recordEvent(EventLogItemKind.AtlasReconstructionPrecomputedComplete, {complete: complete}, user, t);

            const update = {
                status: complete ? AtlasReconstructionStatus.ReadyToPublish : AtlasReconstructionStatus.FailedPrecomputed
            }

            await this.update(update, {transaction: t});

            const kind = EventLogItemKind.AtlasReconstructionUpdate;

            await this.recordEvent(kind, update, user, t);

            const reconstruction = await this.getReconstruction();

            await reconstruction.onAtlasReconstructionStatusChanged(user, update.status, t);

        } else {
            // TODO SystemError
            debug(`received unexpected precomputed update (current status: ${this.status})`);
        }
    }

    public async tryStartPublishing(user: User, t: Transaction): Promise<boolean> {
        if (this.status != AtlasReconstructionStatus.ReadyToPublish) {
            // TODO SystemError
            debug(`tried to publish when not ready (current status: ${this.status})`);
            return false;
        }

        const update = {status: AtlasReconstructionStatus.PendingSearchIndexing};

        await this.update(update);

        await this.recordEvent(EventLogItemKind.AtlasReconstructionIndexingRequest, update, user, t);

        return true;
    }

    public static async getIndexable(limit: number = null): Promise<AtlasReconstruction[]> {
        return AtlasReconstruction.findAll({
            where: {
                status: AtlasReconstructionStatus.PendingSearchIndexing
            },
            limit: limit,
        });
    }

    public async updateSearchIndex(user: User) {
        await this.sequelize.transaction(async (t) => {
            const operation = new SearchIndexOperation(this);

            await operation.process(t);

            const now = Date.now();

            const update = {
                status: AtlasReconstructionStatus.Published,
                searchIndexedAt: now,
                publishedAt: now,
            }

            await this.update(update);

            await this.recordEvent(EventLogItemKind.AtlasReconstructionIndexingComplete, update, user, t);

            const reconstruction = await this.getReconstruction();

            await reconstruction.onAtlasReconstructionStatusChanged(user, update.status, t);
        });
    }

    public static async nearestNode(id: string, location: number[]): Promise<NearestNodeOutput> {
        const output = {
            reconstructionId: id,
            location: location,
            node: null,
            error: null
        };
        if (!location || location.length < 3) {
            output.error = "invalid location argument";
            return output;
        }

        let reconstruction: AtlasReconstruction = null;

        try {
            reconstruction = await this.findByPk(id);
        } catch (err) {
            output.error = err.message;
            return output;
        }

        if (!reconstruction) {
            output.error = "reconstruction id not found";
            return output;
        }

        let tree: KDTree;

        let nodeId: string = null;

        if (this._nearestNodeCache.has(id)) {
            tree = this._nearestNodeCache.get(id);
        } else {
            const nodes = await reconstruction.getAtlasNodes();
            if (!this._nearestNodeCache.has(reconstruction.id)) {
                tree = new KDTree(nodes.map(n => n.toJSON()));
                this._nearestNodeCache.set(reconstruction.id, tree);
            } else {
                tree = this._nearestNodeCache.get(reconstruction.id);
            }
        }

        if (tree) {
            const result = tree.nearest({x: location[0], y: location[1], z: location[2]})

            if (result.length > 0) {
                nodeId = result[0].point.id;
            }
        }

        if (nodeId == null) {
            output.error = "could not identify nearest node";
            return output;
        }

        output.node = await AtlasNode.findByPk(nodeId);

        return output;
    }

    public static async getAsJSON(user: User, id: string, options: JsonParts = defaultJsonParts): Promise<PortalJsonReconstructionContainer | null> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const axonOffset = options.axonOffset ?? 0;
        const axonLimit = options.axonLimit ?? null;
        const dendriteOffset = options.dendriteOffset ?? 0;
        const dendriteLimit = options.dendriteLimit ?? null;

        const needsAxon = axonLimit == null || axonLimit > 0;
        const needsDendrite = dendriteLimit == null || dendriteLimit > 0;

        const includes: any[] = [{
            model: User,
            as: "Reviewer"
        }];

        includes.push({
            model: Reconstruction,
            include: [{
                model: User,
                as: "Annotator"
            }, {
                model: User,
                as: "Reviewer"
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
        });

        const reconstruction = await AtlasReconstruction.findByPk(id, {
            include: includes.length > 0 ? includes : undefined
        });

        if (!reconstruction) {
            return null;
        }

        const result: PortalJsonReconstructionContainer = {
            comment: reconstruction.Reconstruction.sourceComments || reconstruction.sourceComments,
            neurons: []
        };

        let soma = await reconstruction.getSoma({include: [{model: AtlasStructure}]});

        const label = reconstruction.Reconstruction.Neuron.Specimen.Injections.map(i => ({
            virus: i.InjectionVirus?.name ?? "",
            fluorophore: i.Fluorophore?.name ?? ""
        }));

        const data: PortalJsonReconstruction = {
            id: reconstruction.Reconstruction.Neuron.id,
            idString: reconstruction.Reconstruction.Neuron.label,
            DOI: reconstruction.doi,
            sample: reconstruction.Reconstruction.Neuron.Specimen.toPortalJson(),
            label: label.length > 0 ? label[0] : null,
            annotationSpace: {
                version: 3,
                description: "Annotation Space: CCFv3.0 Axes> X: Anterior-Posterior; Y: Inferior-Superior; Z:Left-Right"
            },
            annotator: reconstruction.Reconstruction.Annotator?.DisplayName ?? null,
            proofreader: reconstruction.Reviewer?.DisplayName ?? null,
            peerReviewer: reconstruction.Reconstruction.Reviewer?.DisplayName ?? null,
            soma: soma.toJSON() ?? null,
            axonId: reconstruction.id,
            dendriteId: reconstruction.id
        };

        if (data.soma) {
            data.soma.allenId = soma?.AtlasStructure?.structureId ?? null;
        }

        function nodeWhere(structureId: string) {
            return {
                reconstructionId: reconstruction.id,
                neuronStructureId: {
                    [Op.in]: [NeuronStructure.SomaNeuronStructureId, structureId]
                }
            }
        }

        if (needsAxon) {
            const totalAxonCount = await AtlasNode.count({
                where: nodeWhere(NeuronStructure.AxonStructureId)
            });

            const options: FindOptions = {
                where: nodeWhere(NeuronStructure.AxonStructureId),
                include: [{
                    model: NodeStructure,
                }, {
                    model: AtlasStructure,
                }],
                order: [["index", "ASC"]],
                offset: axonOffset
            };

            if (axonLimit != null) {
                options["limit"] = axonLimit;
            }

            const axonNodes = await AtlasNode.findAll(options);

            data.axon = mapNodes(axonNodes, NodeStructures.axon);
            data.axon[0].structureIdentifier = NodeStructures.soma;
            data.axonChunkInfo = {
                totalCount: totalAxonCount,
                offset: axonOffset,
                limit: axonLimit ?? totalAxonCount,
                hasMore: axonOffset + (axonLimit ?? totalAxonCount) < totalAxonCount
            };
        }

        if (needsDendrite) {
            const totalDendriteCount = await AtlasNode.count({
                where: nodeWhere(NeuronStructure.DendriteStructureId)
            });

            const options: FindOptions = {
                where: nodeWhere(NeuronStructure.DendriteStructureId),
                include: [{
                    model: NodeStructure
                }, {
                    model: AtlasStructure
                }],
                order: [["index", "ASC"]],
                offset: dendriteOffset
            };

            if (dendriteLimit != null) {
                options["limit"] = dendriteLimit;
            }

            const dendriteNodes = await AtlasNode.findAll(options);

            data.dendrite = mapNodes(dendriteNodes, NodeStructures.basalDendrite);
            data.dendrite[0].structureIdentifier = NodeStructures.soma;
            data.dendriteChunkInfo = {
                totalCount: totalDendriteCount,
                offset: dendriteOffset,
                limit: dendriteLimit ?? totalDendriteCount,
                hasMore: dendriteOffset + (dendriteLimit ?? totalDendriteCount) < totalDendriteCount
            };
        }

        if (needsAxon || needsDendrite) {
            const atlasStructures = await AtlasNode.findAll({
                where: {
                    reconstructionId: {[Op.in]: [reconstruction.id]},
                    atlasStructureId: {[Op.ne]: null}
                },
                attributes: [],
                include: [{
                    model: AtlasStructure,
                    attributes: ["id", "structureId", "name", "safeName", "acronym", "structureIdPath", "defaultColor"]
                }],
                group: ["AtlasStructure.id"],
                raw: true
            });

            const unique = uniqBy(atlasStructures, "AtlasStructure.id");

            data.allenInformation = unique.map(s => ({
                allenId: s["AtlasStructure.structureId"],
                name: s["AtlasStructure.name"],
                safeName: s["AtlasStructure.safeName"],
                acronym: s["AtlasStructure.acronym"],
                structurePath: s["AtlasStructure.structureIdPath"],
                graphOrder: 0,
                colorHex: s["AtlasStructure.defaultColor"]
            }));
        }

        result.neurons.push(data);

        return result;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return AtlasReconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        sourceUrl: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        sourceComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        status: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        lengthMillimeters: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        doi: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        nodeCounts: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        nodeStructureAssignmentAt: DataTypes.DATE,
        searchIndexedAt: DataTypes.DATE,
        publishedAt: DataTypes.DATE
    }, {
        tableName: AtlasReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    AtlasReconstruction.belongsTo(User, {foreignKey: "reviewerId", as: "Reviewer"});
    AtlasReconstruction.belongsTo(Reconstruction, {foreignKey: "reconstructionId"});
    AtlasReconstruction.belongsTo(AtlasNode, {foreignKey: "somaNodeId", as: "Soma"});
    AtlasReconstruction.hasOne(QualityControl, {foreignKey: "reconstructionId"});
    AtlasReconstruction.hasOne(Precomputed, {foreignKey: "reconstructionId"});
    AtlasReconstruction.hasMany(AtlasNode, {foreignKey: "reconstructionId"});
};
