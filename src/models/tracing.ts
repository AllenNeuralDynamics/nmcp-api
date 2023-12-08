import {Sequelize, DataTypes, BelongsToGetAssociationMixin, HasManyGetAssociationsMixin, Op} from "sequelize";

import {BaseModel, DeleteOutput} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {TracingNode, TracingNodeMutationData} from "./tracingNode";
import {Neuron} from "./neuron";
import {ITracingPage, ITracingPageInput, IUpdateTracingOutput, IUploadFile, IUploadOutput} from "../graphql/serverResolvers";
import {swcParse} from "../util/SwcParser";
import {StructureIdentifier, StructureIdentifiers} from "./structureIdentifier";
import {RegistrationKind} from "./registrationKind";
import * as fs from "fs";
import {ServiceOptions} from "../options/serviceOptions";
import {performNodeMap} from "../transform/tracingTransformWorker";
import {SearchContent} from "./searchContent";
import {addTracing} from "../rawquery/tracingQueryMiddleware";

const debug = require("debug")("mnb:sample-api:tracing");

export interface ITracingInput {
    id?: string;
    filename?: string;
    fileComments?: string;
    annotator?: string;
    tracingStructureId?: string;
    neuronId?: string;
}


export interface TransformResult {
    tracing: Tracing;
    error: string;
}

export class Tracing extends BaseModel {
    public id: string;
    public filename: string;
    public fileComments: string;
    public annotator: string;
    public registration?: number;
    public nodeCount?: number;
    public pathCount?: number;
    public branchCount?: number;
    public endCount?: number;
    public somaNodeId: string;
    public neuronId: string;
    public tracingStructureId?: string;

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getNodes!: HasManyGetAssociationsMixin<TracingNode>;

    public Nodes?: TracingNode[];

    public static async getTracings(queryInput: ITracingPageInput): Promise<ITracingPage> {
        let out: ITracingPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            matchCount: 0,
            tracings: []
        };

        let options = {where: {}};

        options.where["registration"] = {[Op.ne]: RegistrationKind.Candidate}

        out.totalCount = await Tracing.count(options);

        if (queryInput) {
            if (queryInput.tracingStructureId) {
                options.where["tracingStructureId"] = queryInput.tracingStructureId;
            }

            if (queryInput.neuronIds && queryInput.neuronIds.length > 0) {
                options.where["neuronId"] = {[Op.in]: queryInput.neuronIds}
            }

            out.matchCount = await Tracing.count(options);

            options["order"] = [["createdAt", "DESC"]];

            if (queryInput.offset) {
                options["offset"] = queryInput.offset;
                out.offset = queryInput.offset;
            }

            if (queryInput.limit) {
                options["limit"] = queryInput.limit;
                out.limit = queryInput.limit;
            }
        } else {
            out.matchCount = out.totalCount;
        }

        if (out.limit === 1) {
            out.tracings = [await Tracing.findOne(options)];
        } else {
            out.tracings = await Tracing.findAll(options);
        }

        return out;
    }

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

    public static async getCandidateTracings(queryInput: ITracingPageInput): Promise<ITracingPage> {
        let out: ITracingPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            matchCount: 0,
            tracings: []
        };

        let options = {where: {}};

        options.where["registration"] = {[Op.eq]: RegistrationKind.Candidate}

        out.totalCount = await Tracing.count(options);

        if (queryInput) {
            out.matchCount = await Tracing.count(options);

            options["order"] = [["createdAt", "DESC"]];

            if (queryInput.offset) {
                options["offset"] = queryInput.offset;
                out.offset = queryInput.offset;
            }

            if (queryInput.limit) {
                options["limit"] = queryInput.limit;
                out.limit = queryInput.limit;
            }
        } else {
            out.matchCount = out.totalCount;
        }

        if (out.limit === 1) {
            out.tracings = [await Tracing.findOne(options)];
        } else {
            out.tracings = await Tracing.findAll(options);
        }

        return out;
    }

    public static async getCandidateTracing(neuronId: string): Promise<Tracing> {
        let options = {where: {}};

        options.where["neuronId"] = {[Op.eq]: neuronId}
        options.where["registration"] = {[Op.eq]: RegistrationKind.Candidate}

        return await Tracing.findOne(options);
    }

    public static async getCountForNeuron(neuronId: string): Promise<number> {
        if (!neuronId || neuronId.length === 0) {
            return 0;
        }

        let options = {where: {}};

        options.where["neuronId"] = {[Op.eq]: neuronId}
        options.where["registration"] = {[Op.ne]: RegistrationKind.Candidate}

        return Tracing.count(options);
    }

    public static async createCandidateTracing(neuron: Neuron): Promise<Tracing> {
        const tracingData = {
            filename: "N/A",
            fileComments: "Placeholder tracing for candidate neuron",
            annotator: "System",
            registration: RegistrationKind.Candidate,
            nodeCount: 1,
            pathCount: 0,
            branchCount: 0,
            endCount: 0,
            neuronId: neuron.id,
            tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4"
        };

        const tracing = await Tracing.create(tracingData);

        const nodeData = {
            tracingId: tracing.id,
            sampleNumber: 1,
            parentNumber: -1,
            structureIdentifierId: StructureIdentifier.idForValue(StructureIdentifiers.soma),
            x: neuron.x,
            y: neuron.y,
            z: neuron.z,
            radius: 1,
            lengthToParent: 0,
            brainStructureId: neuron.brainStructureId
        }

        const soma = await TracingNode.create(nodeData);

        await tracing.update({somaNodeId: soma.id});

        return tracing;
    }

    public static async updateTracing(tracingInput: ITracingInput): Promise<IUpdateTracingOutput> {
        try {
            let tracing = await Tracing.findByPk(tracingInput.id);

            if (!tracing) {
                return {
                    tracing: null,
                    error: {name: "UpdateTracingError", message: "The tracing could not be found"}
                };
            }

            await tracing.update(tracingInput);

            const updatedTracing = await Tracing.findByPk(tracingInput.id);

            return {tracing: updatedTracing, error: null};
        } catch (error) {
            return {tracing: null, error}
        }
    }

    public static async deleteTracing(id: string): Promise<DeleteOutput> {
        let tracing = await Tracing.findByPk(id);

        if (!tracing) {
            return {id, error: "A tracing with that id does not exist"};
        }

        const isCandidate = tracing.registration == RegistrationKind.Candidate;

        try {
            await TracingNode.sequelize.transaction(async (t) => {
                await TracingNode.destroy({where: {tracingId: id}, transaction: t});

                await SearchContent.destroy({where: {tracingId: id}, transaction: t});

                await Tracing.destroy({where: {id: id}, transaction: t});
            });

            debug(`destroyed tracing ${tracing.id}`)

            const tracingCount = await Tracing.count({
                where: {
                    neuronId: tracing.neuronId
                }
            });

            if (tracingCount == 0) {
                const neuron = await Neuron.findByPk(tracing.neuronId);

                await Tracing.createCandidateTracing(neuron);
            }

        } catch (err) {
            debug(err);
            return {id, error: err.message};
        }

        return {id, error: null};
    }

    public static async receiveSwcUpload(annotator: string, neuronId: string, tracingStructureId: string, registrationKind: number, uploadFile: Promise<any>): Promise<IUploadOutput> {
        if (!uploadFile) {
            return {
                tracing: null,
                error: {name: "UploadSwcError", message: "There are no files attached to parse"}
            };
        }

        let file = await uploadFile;

        let tracing: Tracing = null;

        try {
            const parseOutput = await swcParse(file.createReadStream());

            if (parseOutput.rows.length === 0) {
                return {
                    tracing: null,
                    error: {name: "UploadSwcError", message: "Could not find any identifiable node rows"}
                };
            }

            if (parseOutput.somaCount === 0) {
                return {
                    tracing: null,
                    error: {name: "UploadSwcError", message: "There are no soma/root/un-parented nodes in the tracing"}
                };
            }

            if (parseOutput.somaCount > 1) {
                return {
                    tracing: null,
                    error: {
                        name: "UploadSwcError",
                        message: "There is more than one soma/root/un-parented nodes in the tracing"
                    }
                };
            }

            const neuron = await Neuron.findByPk(neuronId);

            const tracingData = {
                filename: file.filename,
                fileComments: parseOutput.comments,
                annotator,
                registration: registrationKind,
                visibility: neuron.visibility,
                nodeCount: parseOutput.rows.length,
                pathCount: parseOutput.pathCount,
                branchCount: parseOutput.branchCount,
                endCount: parseOutput.endCount,
                neuronId,
                tracingStructureId
            };

            let nodeData: TracingNodeMutationData[] = parseOutput.rows.map(row => {
                return {
                    tracingId: null,
                    sampleNumber: row.sampleNumber,
                    parentNumber: row.parentNumber,
                    structureIdentifierId: StructureIdentifier.idForValue(row.structure),
                    x: row.x,
                    y: row.y,
                    z: row.z,
                    radius: row.radius,
                    lengthToParent: 0
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

            const candidateTracing = await Tracing.findOne({
                where: {
                    neuronId: tracingData.neuronId,
                    registration: RegistrationKind.Candidate
                }
            });

            if (candidateTracing) {
                await Tracing.deleteTracing(candidateTracing.id);
            }

            await Tracing.applyTransform(tracing.id);

            addTracing(tracing);

        } catch (error) {
            return {tracing: null, error};
        }

        return {tracing, error: null};
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
        annotator: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        registration: DataTypes.INTEGER,
        nodeCount: DataTypes.INTEGER,
        pathCount: DataTypes.INTEGER,
        branchCount: DataTypes.INTEGER,
        endCount: DataTypes.INTEGER,
        visibility: DataTypes.INTEGER,
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
    Tracing.belongsTo(Neuron, {foreignKey: "neuronId"});
    Tracing.belongsTo(TracingNode, {foreignKey: "somaNodeId", as: "Soma"});
};
