import {Sequelize, DataTypes, BelongsToGetAssociationMixin, HasManyGetAssociationsMixin, Op} from "sequelize";

import {BaseModel} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {TracingNode, TracingNodeMutationData} from "./tracingNode";
import {Neuron} from "./neuron";
import {ITracingPage, ITracingPageInput, IUpdateTracingOutput, IUploadFile, IUploadOutput} from "../graphql/serverResolvers";
import {swcParse} from "../util/SwcParser";
import {StructureIdentifier} from "./structureIdentifier";

const debug = require("debug")("mnb:sample-api:tracing");

export interface ITracingInput {
    id?: string;
    filename?: string;
    fileComments?: string;
    annotator?: string;
    tracingStructureId?: string;
    neuronId?: string;
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

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getNodes!: HasManyGetAssociationsMixin<TracingNode>;

    public static async getTracings(queryInput: ITracingPageInput): Promise<ITracingPage> {
        let out: ITracingPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            matchCount: 0,
            tracings: []
        };

        out.totalCount = await Tracing.count({});

        let options = {where: {}};

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

    public static async receiveSwcUpload(annotator: string, neuronId: string, tracingStructureId: string, uploadFile: Promise<any>): Promise<IUploadOutput> {
        if (!uploadFile) {
            return {
                tracing: null,
                transformSubmission: false,
                error: {name: "UploadSwcError", message: "There are no files attached to parse"}
            };
        }

        let file = await uploadFile;

        let tracing: Tracing = null;

        let transformSubmission = false;

        try {
            const parseOutput = await swcParse(file.createReadStream());

            if (parseOutput.rows.length === 0) {
                return {
                    tracing: null,
                    transformSubmission: false,
                    error: {name: "UploadSwcError", message: "Could not find any identifiable node rows"}
                };
            }

            if (parseOutput.somaCount === 0) {
                return {
                    tracing: null,
                    transformSubmission: false,
                    error: {name: "UploadSwcError", message: "There are no soma/root/un-parented nodes in the tracing"}
                };
            }

            if (parseOutput.somaCount > 1) {
                return {
                    tracing: null,
                    transformSubmission: false,
                    error: {
                        name: "UploadSwcError",
                        message: "There is more than one soma/root/un-parented nodes in the tracing"
                    }
                };
            }

            const tracingData = {
                annotator,
                neuronId,
                tracingStructureId,
                filename: file.filename,
                fileComments: parseOutput.comments
            };

            let nodeData: TracingNodeMutationData[] = parseOutput.rows.map(row => {
                return {
                    swcTracingId: null,
                    sampleNumber: row.sampleNumber,
                    parentNumber: row.parentNumber,
                    structureIdentifierId: StructureIdentifier.idForValue(row.structure),
                    x: row.x,
                    y: row.y,
                    z: row.z,
                    radius: row.radius
                }
            });

            await Tracing.sequelize.transaction(async (t) => {
                tracing = await Tracing.create(tracingData, {transaction: t});

                nodeData = nodeData.map(node => {
                    node.swcTracingId = tracing.id;
                    return node;
                });

                return TracingNode.bulkCreate(nodeData, {transaction: t});
            });

            debug(`inserted ${nodeData.length} nodes from ${file.filename}`);

        } catch (error) {
            return {tracing: null, transformSubmission: false, error};
        }

        return {tracing, transformSubmission, error: null};
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
};
