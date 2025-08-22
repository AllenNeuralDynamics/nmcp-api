import * as fs from "fs";
import * as path from "path";
import {DataTypes, HasManyGetAssociationsMixin, Op, Sequelize} from "sequelize";

import {DeleteOutput} from "./baseModel";
import {AxonStructureId, DendriteStructureId, TracingStructure} from "./tracingStructure";
import {TracingNode, TracingNodeMutationData} from "./tracingNode";
import {IUploadOutput} from "../graphql/secureResolvers";
import {StructureIdentifier, StructureIdentifiers} from "./structureIdentifier";
import {ServiceOptions} from "../options/serviceOptions";
import {performNodeMap} from "../transform/tracingTransformWorker";
import {SearchContent} from "./searchContent";
import {Reconstruction} from "./reconstruction";
import {jsonChunkParse, jsonParse} from "../util/JsonParser";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Neuron} from "./neuron";
import {FiniteMap} from "../util/finiteMap";
import {KDTree} from "../util/kdtree";
import {ITracingDataInput, IUploadIntermediate, TracingBaseModel} from "./tracingBaseModel";
import {SwcData} from "../util/SwcParser";

const debug = require("debug")("mnb:nmcp-api:tracing");

export interface TransformResult {
    tracing: Tracing;
    error: string;
}

export class Tracing extends TracingBaseModel {
    public somaNodeId: string;

    public getNodes!: HasManyGetAssociationsMixin<TracingNode>

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

    public static async getUntransformed(publishedOnly: boolean): Promise<Tracing[]> {
        let options = {
            where: {
                "searchTransformAt": null
            }
        };

        if (publishedOnly) {
            options.where["$Reconstruction.status$"] = ReconstructionStatus.Published
            options["include"] = [
                {
                    model: Reconstruction,
                    as: "Reconstruction",
                    attributes: ["id", "status"],
                    required: true
                }
            ]
        }

        // options.where["searchTransformAt"] = {[Op.eq]: null}

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

        // TODO Remove from raw tracing cache

        return {id, error: null};
    }

    public static async createTracingFromUpload(reconstructionId: string, tStructureId: string, uploadFile: Promise<any>): Promise<IUploadOutput> {
        if (!uploadFile) {
            return {
                tracings: null,
                error: {name: "UploadSwcError", message: "There are no files attached to parse"}
            };
        }

        const file = await uploadFile;

        try {
            const tracingInputs = await TracingBaseModel.parseUploadedFile(file, tStructureId);

            return Tracing.createTracingFromInput(reconstructionId, tracingInputs, file.filename);
        } catch (err) {
            return {tracings: null, error: err};
        }
    }

    public static async createTracingFromJson(reconstructionId: string, source: string, performInsert: boolean = true) {
        let tracingInputs: ITracingDataInput[] = [];

        let axonData: SwcData, dendriteData: SwcData;

        try {
            [axonData, dendriteData] = await jsonChunkParse(fs.createReadStream(source));
        } catch (err) {
            debug(`Error parsing JSON file ${source}: ${err.message}`);
            return {tracings: null, error: `Error parsing JSON file ${source}: ${err.message}`};
        }

        // const [axonData, dendriteData] = await jsonParse(fs.createReadStream(source));

        if (axonData) {
            tracingInputs.push({input: axonData, tracingStructureId: AxonStructureId});
        }

        if (dendriteData) {
            tracingInputs.push({input: dendriteData, tracingStructureId: DendriteStructureId});
        }

        if (tracingInputs.length < 2) {
            return {tracings: null, error: `${axonData ? "" : "Axon data is missing.  "}${dendriteData ? "" : "Dendrite data is missing."}`};
        } else {
            debug(`Found ${tracingInputs.length} tracing inputs in JSON file ${source}`);
        }

        if (performInsert) {
            return await Tracing.createTracingFromInput(reconstructionId, tracingInputs, path.basename(source), true);
        } else {
            return {tracings: null, error: null};
        }
    }

    public static async createTracingFromInput(reconstructionId: string, tracingInputs: ITracingDataInput[], source: string, insertOnly: boolean = false): Promise<IUploadOutput> {
        try {
            const promises: Promise<IUploadIntermediate>[] = tracingInputs.map(async (input) => {
                const swcData = input.input;
                const tracingStructureId = input.tracingStructureId;

                if (swcData.sampleCount === 0) {
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

                // Reconstruction
                const reconstruction = await Reconstruction.findByPk(reconstructionId);

                // Only allow one axon/dendrite per reconstruction.
                const existing = await Tracing.findOne({
                    where: {
                        reconstructionId: reconstruction.id,
                        tracingStructureId: tracingStructureId
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
                    nodeCount: swcData.sampleCount,
                    pathCount: swcData.pathCount,
                    branchCount: swcData.branchCount,
                    endCount: swcData.endCount,
                    reconstructionId: reconstruction.id,
                    tracingStructureId
                };

                let nodeData: TracingNodeMutationData[] = swcData.getSamples().map(sample => {
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
                        brainStructureId: null
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

    public static async applyTransform(id: string): Promise<TransformResult> {
        try {
            const tracing = await Tracing.findByPk(id);

            if (!fs.existsSync(ServiceOptions.ccfv30OntologyPath)) {
                debug(`CCF v3.0 ontology file ${ServiceOptions.ccfv30OntologyPath} does not exist`);
                return {
                    tracing: null,
                    error: `CCF v3.0 ontology file ${ServiceOptions.ccfv30OntologyPath} does not exist`
                };
            }

            return new Promise((resolve, reject) => {
                setTimeout(async () => {
                    // Reload with nodes and required data for transform.
                    const fullTracing = await Tracing.findOneForTransform(id);

                    await performNodeMap(fullTracing);

                    resolve({tracing: fullTracing, error: null});
                }, 0);
            });
        } catch (err) {
            debug(err)
            return {tracing: null, error: err};
        }
    }

    public async nearestNode(location: number[]): Promise<any> {
        let tree: KDTree = null;

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

        const result = tree.nearest({x: location[2], y: location[1], z: location[0]})

        if (result.length > 0) {
            return {id: result[0].point.id, distance: result[0].tree_distance};
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
