import {BelongsToGetAssociationMixin, DataTypes, HasManyGetAssociationsMixin, Op, Sequelize} from "sequelize";

import {BaseModel, DeleteOutput} from "./baseModel";
import {AxonStructureId, DendriteStructureId, TracingStructure} from "./tracingStructure";
import {TracingNode, TracingNodeMutationData} from "./tracingNode";
import {IUploadOutput} from "../graphql/serverResolvers";
import {SwcData, swcParse} from "../util/SwcParser";
import {StructureIdentifier, StructureIdentifiers} from "./structureIdentifier";
import * as fs from "fs";
import {ServiceOptions} from "../options/serviceOptions";
import {performNodeMap} from "../transform/tracingTransformWorker";
import {SearchContent} from "./searchContent";
import {addTracingToMiddlewareCache} from "../rawquery/tracingQueryMiddleware";
import {Reconstruction} from "./reconstruction";
import {jsonParse} from "../util/JsonParser";

const debug = require("debug")("mnb:sample-api:tracing");

export interface ITracingInput {
    id?: string;
    filename?: string;
    fileComments?: string;
    tracingStructureId?: string;
    neuronId?: string;
}

export interface TransformResult {
    tracing: Tracing;
    error: string;
}

interface IUploadIntermediate {
    tracing: Tracing;
    error: Error;
}

interface ITracingDataInput {
    input: SwcData;
    tracingStructureId: string;
}

export class Tracing extends BaseModel {
    public id: string;
    public filename: string;
    public fileComments: string;
    public nodeCount?: number;
    public pathCount?: number;
    public branchCount?: number;
    public endCount?: number;
    public somaNodeId: string;
    public reconstructionId: string;
    public tracingStructureId?: string;

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;
    public getNodes!: HasManyGetAssociationsMixin<TracingNode>;

    public Nodes?: TracingNode[];

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

    public static async getUntransformed(): Promise<Tracing[]> {
        let options = {where: {}};

        options.where["searchTransformAt"] = {[Op.eq]: null}

        return Tracing.findAll(options);
    }

    public static async deleteTracing(id: string, removeAnnotations: boolean = true): Promise<DeleteOutput> {
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

        if (removeAnnotations && count == 0) {
            // If this is the last tracing associated with a reconstruction, remove to reset the status.
            await Reconstruction.remove(tracing.reconstructionId);
        }

        if (count == 1) {
            // Was complete, one tracing has been removed, mark as approved again so a replacement could be uploaded.
            await Reconstruction.reopenAnnotationAsApproved(tracing.reconstructionId);
        }

        // TODO Remove from raw tracing cache

        return {id, error: null};
    }

    /**
     *
     * @param userId
     * @param neuronId
     * @param tracingStructureId
     * @param duration
     * @param length
     * @param uploadFile
     */
    public static async createApprovedTracing(userId: string, neuronId: string, tStructureId: string, uploadFile: Promise<any>): Promise<IUploadOutput> {
        if (!uploadFile) {
            return {
                tracings: null,
                error: {name: "UploadSwcError", message: "There are no files attached to parse"}
            };
        }

        let file = await uploadFile;

        let tracingInputs: ITracingDataInput[] = [];

        try {
            if (file.filename.endsWith(".json")) {
                const [axonData, dendriteData] = await jsonParse(file.createReadStream());

                tracingInputs.push({input: axonData, tracingStructureId: AxonStructureId});
                tracingInputs.push({input: dendriteData, tracingStructureId: DendriteStructureId});
            } else {
                const data = await swcParse(file.createReadStream());
                tracingInputs.push({input: data, tracingStructureId: tStructureId});
            }

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
                        error: {name: "UploadSwcError", message: "There are no soma/root/un-parented nodes in the tracing"}
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

                // Reconstruction for this user and neuron
                const reconstruction = await Reconstruction.findOne({
                    where: {annotatorId: userId, neuronId: neuronId}
                });

                // Only allow one axon/dendrite per reconstruction.
                const existing = await Tracing.findOne({
                    where: {
                        reconstructionId: reconstruction.id,
                        tracingStructureId: tracingStructureId
                    }
                });

                if (existing) {
                    await Tracing.deleteTracing(existing.id, false);
                }

                const tracingData = {
                    filename: file.filename,
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

                    tracing.Nodes = await TracingNode.bulkCreate(nodeData, {transaction: t});
                });

                debug(`inserted ${nodeData.length} nodes from ${file.filename}`);

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

                addTracingToMiddlewareCache(tracing);

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
                return {tracing: null, error: `CCF v3.0 ontology file ${ServiceOptions.ccfv30OntologyPath} does not exist`};
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
}

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

export const modelAssociate = () => {
    Tracing.hasMany(TracingNode, {foreignKey: "tracingId", as: "Nodes"});
    Tracing.belongsTo(TracingStructure, {foreignKey: "tracingStructureId"});
    Tracing.belongsTo(Reconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
    Tracing.belongsTo(TracingNode, {foreignKey: "somaNodeId", as: "Soma"});
};
