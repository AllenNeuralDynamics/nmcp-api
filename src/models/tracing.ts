import * as fs from "fs";
import * as path from "path";
import {BelongsToGetAssociationMixin, DataTypes, HasManyGetAssociationsMixin, Op, Sequelize} from "sequelize";

import {BaseModel, DeleteOutput} from "./baseModel";
import {AxonStructureId, DendriteStructureId, TracingStructure} from "./tracingStructure";
import {TracingNode, TracingNodeMutationData} from "./tracingNode";
import {ReconstructionUploadOutput} from "../graphql/secureResolvers";
import {StructureIdentifier, StructureIdentifiers} from "./structureIdentifier";
import {ServiceOptions} from "../options/serviceOptions";
import {SearchContent} from "./searchContent";
import {Reconstruction} from "./reconstruction";
import {jsonChunkParse} from "../io/jsonParser";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Neuron} from "./neuron";
import {FiniteMap} from "../util/finiteMap";
import {KDTree} from "../util/kdtree";

import {SimpleNeuronStructure, ParsedReconstruction, parseJsonFile, parseSwcFile} from "../io/parsedReconstruction";
import {SearchContentOperation} from "../transform/searchContentOperation";
import {AtlasStructure} from "./atlasStructure";
import {findBrainStructure} from "../transform/atlasLookupService";
import {QualityCheckStatus} from "./qualityCheckStatus";

const debug = require("debug")("nmcp:nmcp-api:tracing")

const preferredDatabaseChunkSize = 25000;

export interface TransformResult {
    tracing: Tracing;
    error: string;
}

export interface IUploadIntermediate {
    tracing: Tracing;
    error: Error;
}
export class Tracing extends BaseModel {
    public id: string;
    public filename: string;
    // public fileComments: string;
    public nodeCount?: number;
    public pathCount?: number;
    public branchCount?: number;
    public endCount?: number;
    public reconstructionId: string;
    public tracingStructureId?: string;

    public somaNodeId: string;
    public nodeLookupAt: string;
    public searchTransformAt: Date;

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;
    public getNodes!: HasManyGetAssociationsMixin<TracingNode>

    public Reconstruction: Reconstruction;
    public Nodes?: TracingNode[];

    private static _nearestNodeCache: FiniteMap<string, KDTree> = new FiniteMap<string, KDTree>(10);

    public static async findOneForTransform(id: string): Promise<Tracing> {
        return Tracing.findByPk(id, {
            include: [{
                model: TracingNode,
                as: "Nodes",
                include: [{
                    model: StructureIdentifier,
                    as: "StructureIdentifier",
                    attributes: ["id", "value"]
                }]
            }, {
                model: Reconstruction,
                as: "Reconstruction",
                attributes: ["id", "neuronId"],
                include: [{
                    model: Neuron,
                    as: "Neuron",
                    attributes: ["id", "brainStructureId"]
                }]
            }]
        });
    }

    public static async getForReconstruction(reconstructionId: string): Promise<Tracing[]> {
        if (!reconstructionId || reconstructionId.length === 0) {
            return [];
        }

        let options = {where: {}};

        options.where["reconstructionId"] = {[Op.eq]: reconstructionId}

        return Tracing.findAll(options);
    }

    public static async getForNeuron(neuronId: string): Promise<Tracing[]> {
        if (!neuronId || neuronId.length === 0) {
            return [];
        }

        const reconstructionIds = (await Reconstruction.getForNeuron(neuronId)).map(r => r.id);

        return Tracing.findAll({where: {reconstructionId: {[Op.in]: reconstructionIds}}});
    }

    public static async getCountForReconstruction(reconstructionId: string): Promise<number> {
        if (!reconstructionId || reconstructionId.length === 0) {
            return 0;
        }

        let options = {where: {}};

        options.where["reconstructionId"] = {[Op.eq]: reconstructionId}

        return Tracing.count(options);
    }

    public static async getNodeStructureNotAssigned(): Promise<Tracing[]> {
        return Tracing.getPublishedPending("nodeLookupAt", ReconstructionStatus.PendingStructureAssignment);
    }

    public static async getSearchContentsNotCalculated(): Promise<Tracing[]> {
        return Tracing.getPublishedPending("searchTransformAt", ReconstructionStatus.PendingSearchContents);
    }

    private static async getPublishedPending(whereField: string, status: ReconstructionStatus): Promise<Tracing[]> {
        let options = {
            where: {
                [whereField]: null
            }
        };

        options.where["$Reconstruction.status$"] = status;

        options["include"] = [
            {
                model: Reconstruction,
                as: "Reconstruction",
                attributes: ["id", "status"],
                required: true
            }
        ]

        return Tracing.findAll(options);
    }

    public static async deleteTracing(id: string, removeReconstruction: boolean = true): Promise<DeleteOutput> {
        let tracing = await Tracing.findByPk(id);

        if (!tracing) {
            return {id, error: "A tracing with that id does not exist"};
        }

        // Remove tracing and nodes.
        try {
            await TracingNode.sequelize.transaction(async (t) => {
                await TracingNode.destroy({where: {tracingId: id}, transaction: t});

                await SearchContent.destroy({where: {tracingId: id}, transaction: t});

                await Tracing.destroy({where: {id: id}, transaction: t});
            });

            debug(`destroyed tracing ${tracing.id}`);
        } catch (err) {
            debug(err);
            return {id, error: err.message};
        }

        const count = await Tracing.getCountForReconstruction(tracing.reconstructionId);

        if (removeReconstruction && count == 0) {
            // If this is the last tracing associated with a reconstruction, remove to reset the status.
            await Reconstruction.destroy({
                where: {id: tracing.reconstructionId}
            });
        }

        if (count == 1) {
            // Was complete, one tracing has been removed, mark as approved again so a replacement could be uploaded.
            await Reconstruction.reopenAnnotationAsApproved(tracing.reconstructionId);
        }

        return {id, error: null};
    }

    public static async createTracingFromUpload(reconstructionId: string, structureId: string, uploadFile: Promise<any>): Promise<ReconstructionUploadOutput> {
        if (!uploadFile) {
            return {
                tracings: null,
                error: {name: "UploadSwcError", message: "There are no files attached to parse"}
            };
        }

        const file = await uploadFile;

        try {
            let parsedReconstruction: ParsedReconstruction;

            if (file.filename.toLowerCase().endsWith(".json")) {
                parsedReconstruction = await parseJsonFile(file);
            } else {
                const parsedStructure = await parseSwcFile(file, structureId);

                parsedReconstruction = {
                    source: file.filename,
                    comments: parsedStructure.comments,
                    axon: structureId == AxonStructureId ? parsedStructure : null,
                    dendrite: structureId == DendriteStructureId ? parsedStructure : null,
                }
            }

            return Tracing.createTracingFromInput(reconstructionId, parsedReconstruction, file.filename);
        } catch (err) {
            return {tracings: null, error: err};
        }
    }

    public static async createTracingFromJson(reconstructionId: string, source: string, performInsert: boolean = true) {
        let axonData: SimpleNeuronStructure, dendriteData: SimpleNeuronStructure;

        try {
            [axonData, dendriteData] = await jsonChunkParse(fs.createReadStream(source));
        } catch (err) {
            debug(`Error parsing JSON file ${source}: ${err.message}`);
            return {tracings: null, error: `Error parsing JSON file ${source}: ${err.message}`};
        }

        if (axonData == null || dendriteData == null) {
            return {tracings: null, error: `${axonData ? "" : "Axon data is missing.  "}${dendriteData ? "" : "Dendrite data is missing."}`};
        }

        if (performInsert) {
            const parsedReconstruction: ParsedReconstruction = {
                source: source,
                comments: axonData.comments,
                axon: axonData,
                dendrite: dendriteData
            };

            return await Tracing.createTracingFromInput(reconstructionId, parsedReconstruction, path.basename(source), true);
        } else {
            return {tracings: null, error: null};
        }
    }

    public static async createTracingFromInput(reconstructionId: string, parsedReconstruction: ParsedReconstruction, source: string, insertOnly: boolean = false): Promise<ReconstructionUploadOutput> {
        try {
            // Reconstruction
            const reconstruction = await Reconstruction.findByPk(reconstructionId);

            if (!reconstruction) {
                return {tracings: null, error: {name: "CreateTracingError", message: `reconstruction ${reconstructionId} not found`}};
            }

            const promises: Promise<IUploadIntermediate>[] = [parsedReconstruction.axon, parsedReconstruction.dendrite].filter(s => s).map(async (swcData) => {
                if (swcData.nodeCount === 0) {
                    return {
                        tracing: null,
                        error: {name: "UploadSwcError", message: "Could not find any identifiable node rows"}
                    };
                }

                if (swcData.somaCount === 0) {
                    return {
                        tracing: null,
                        error: {
                            name: "UploadSwcError",
                            message: "There are no soma/root/un-parented nodes in the tracing"
                        }
                    };
                }

                if (swcData.somaCount > 1) {
                    return {
                        tracing: null,
                        error: {
                            name: "UploadSwcError",
                            message: "There is more than one soma/root/un-parented nodes in the tracing"
                        }
                    };
                }

                let tracing: Tracing = null;

                // Only allow one axon/dendrite per reconstruction.
                const existing = await Tracing.findOne({
                    where: {
                        reconstructionId: reconstruction.id,
                        tracingStructureId: swcData.NeuronStructureId
                    }
                });

                if (existing) {
                    if (insertOnly) {
                        return {tracing: existing, error: null};
                    }

                    await Tracing.deleteTracing(existing.id, false);
                }

                const tracingData = {
                    filename: source,
                    fileComments: swcData.comments,
                    nodeCount: swcData.nodeCount,
                    pathCount: swcData.pathCount,
                    branchCount: swcData.branchCount,
                    endCount: swcData.endCount,
                    reconstructionId: reconstruction.id,
                    tracingStructureId: swcData.NeuronStructureId
                };

                let nodeData: TracingNodeMutationData[] = swcData.getNodes().map(sample => {
                    return {
                        tracingId: null,
                        sampleNumber: sample.sampleNumber,
                        parentNumber: sample.parentNumber,
                        structureIdentifierId: StructureIdentifier.idForValue(sample.structure),
                        x: sample.x,
                        y: sample.y,
                        z: sample.z,
                        radius: sample.radius,
                        lengthToParent: sample.lengthToParent,
                        brainStructureId: sample.brainStructureId
                    }
                });

                await Tracing.sequelize.transaction(async (t) => {
                    tracing = await Tracing.create(tracingData, {transaction: t});

                    nodeData = nodeData.map(node => {
                        node.tracingId = tracing.id;
                        return node;
                    });

                    const chunkSize = 100000;

                    tracing.Nodes = [];

                    for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                        tracing.Nodes = tracing.Nodes.concat(await TracingNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction: t}));
                    }
                });

                debug(`inserted ${nodeData.length} nodes from ${source}`);

                const somaStructureIdentifier = await StructureIdentifier.findOne({where: {value: StructureIdentifiers.soma}});

                const soma = await TracingNode.findOne({
                    where: {
                        tracingId: tracing.id,
                        structureIdentifierId: somaStructureIdentifier.id
                    }
                });

                if (soma) {
                    await tracing.update({somaNodeId: soma.id});
                }

                if (await reconstruction.hasRequiredTracings()) {
                    await reconstruction.update({qualityCheckStatus: QualityCheckStatus.Pending});
                    debug(`updated reconstruction ${reconstruction.id} quality check status to pending`);
                    await Reconstruction.requestQualityCheck(reconstructionId);
                }

                return {tracing, error: null};
            });

            const output: IUploadIntermediate[] = await Promise.all(promises);

            const errors = output.filter(o => o).map(o => o.error);

            return {
                tracings: output.map(o => o.tracing),
                error: errors.length > 0 ? errors[0] : null
            }
        } catch (error) {
            return {tracings: null, error};
        }
    }

    public static async calculateStructureAssignments(id: string) {
        if (!fs.existsSync(ServiceOptions.ccfv30OntologyPath)) {
            debug(`CCF v3.0 ontology file ${ServiceOptions.ccfv30OntologyPath} does not exist`);
            return {
                tracing: null,
                error: `CCF v3.0 ontology file ${ServiceOptions.ccfv30OntologyPath} does not exist`
            };
        }

        let tracing = await Tracing.findByPk(id, {
            include: [{
                model: Reconstruction,
                as: "Reconstruction",
                attributes: ["id", "neuronId"],
                include: [{
                    model: Neuron,
                    as: "Neuron",
                    attributes: ["id", "brainStructureId"]
                }]
            }]
        });

        const count = await TracingNode.count({where: {tracingId: tracing.id}});

        debug(`assigning compartments to ${count} nodes for tracing ${tracing.id}`);

        let failedLookup = 0;

        for (let idx = 0; idx < count; idx += preferredDatabaseChunkSize) {
            const nodes = await TracingNode.findAll({
                where: {tracingId: tracing.id},
                offset: idx,
                limit: preferredDatabaseChunkSize,
                order: [["sampleNumber", "ASC"]]
            });

            const missing = nodes.filter(n => n.brainStructureId == null);

            debug(`\tassigning compartments for chunk starting at ${idx} for tracing ${tracing.id} with ${missing.length} missing structure assignments`);

            for (let node of missing) {
                let brainStructureId = findBrainStructure(node);

                if (!brainStructureId) {
                    failedLookup++;
                    brainStructureId = AtlasStructure.wholeBrainId();
                }

                await node.update({brainStructureId: brainStructureId});
            }
        }

        debug(`\tassignment complete (${failedLookup} failed lookups)`);

        await tracing.update({nodeLookupAt: Date.now()});
    }

    public static async calculateSearchContents(id: string): Promise<TransformResult> {
        try {
            let tracing = await Tracing.findByPk(id, {
                include: [{
                    model: Reconstruction,
                    as: "Reconstruction",
                    attributes: ["id", "neuronId"],
                    include: [{
                        model: Neuron,
                        as: "Neuron",
                        attributes: ["id", "brainStructureId"]
                    }]
                }]
            });

            const operation = new SearchContentOperation(tracing);

            await operation.processTracing();

            await tracing.update({searchTransformAt: Date.now()});

            return {tracing: tracing, error: null}
        } catch (err) {
            debug(err)
            return {tracing: null, error: err};
        }
    }

    public async nearestNode(location: number[]): Promise<any> {
        let tree: KDTree;

        if (Tracing._nearestNodeCache.has(this.id)) {
            tree = Tracing._nearestNodeCache.get(this.id);
        } else {
            const nodes = await this.getNodes();
            if (!Tracing._nearestNodeCache.has(this.id)) {
                tree = new KDTree(nodes.map(n => n.toJSON()));
                Tracing._nearestNodeCache.set(this.id, tree);
            } else {
                tree = Tracing._nearestNodeCache.get(this.id);
            }
        }

        if (tree) {
            const result = tree.nearest({x: location[0], y: location[1], z: location[2]})

            if (result.length > 0) {
                return {id: result[0].point.id, distance: result[0].tree_distance};
            }
        }

        return null;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    Tracing.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        filename: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        // comment lines found in SWC file
        fileComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        nodeCount: DataTypes.INTEGER,
        pathCount: DataTypes.INTEGER,
        branchCount: DataTypes.INTEGER,
        endCount: DataTypes.INTEGER,
        somaNodeId: DataTypes.UUID,
        nodeLookupAt: DataTypes.DATE,
        searchTransformAt: DataTypes.DATE
    }, {
        tableName: "Tracing",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Tracing.hasMany(TracingNode, {foreignKey: "tracingId", as: "Nodes"});
    Tracing.belongsTo(TracingStructure, {foreignKey: "tracingStructureId"});
    Tracing.belongsTo(Reconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
    Tracing.belongsTo(TracingNode, {foreignKey: "somaNodeId", as: "Soma"});
};
