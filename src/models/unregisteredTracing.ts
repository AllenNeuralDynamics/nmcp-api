import {DataTypes, Sequelize} from "sequelize";

import {DeleteOutput} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {IUploadOutput} from "../graphql/secureResolvers";

import {Reconstruction} from "./reconstruction";
import {StructureIdentifier} from "./structureIdentifier";
import {ITracingDataInput, IUploadIntermediate} from "./tracingBaseModel";
import {UnregisteredTracingNode, UnregisteredTracingNodeMutationData} from "./unregisteredTracingNode";
import {TracingBaseModel} from "./tracingBaseModel";

const debug = require("debug")("mnb:nmcp-api:unregistered-tracing");

export class UnregisteredTracing extends TracingBaseModel {

    // public getNodes!: HasManyGetAssociationsMixin<UnregisteredTracingNode>

    public Nodes?: UnregisteredTracingNode[];

    public static async deleteTracing(id: string): Promise<DeleteOutput> {
        let tracing = await UnregisteredTracing.findByPk(id);

        if (!tracing) {
            return {id, error: "An unregistered tracing with that id does not exist"};
        }

        // Remove tracing and nodes.
        try {
            await UnregisteredTracingNode.sequelize.transaction(async (t) => {
                await UnregisteredTracingNode.destroy({where: {tracingId: id}, transaction: t});

                await UnregisteredTracing.destroy({where: {id: id}, transaction: t});
            });

            debug(`destroyed unregistered tracing ${tracing.id}`);
        } catch (err) {
            debug(err);
            return {id, error: err.message};
        }

        return {id, error: null};
    }

    public static async createFromUpload(reconstructionId: string, tStructureId: string, uploadFile: Promise<any>): Promise<IUploadOutput> {
        if (!uploadFile) {
            return {
                tracings: null,
                error: {name: "UploadUnregisteredSwcError", message: "There are no files attached to parse."}
            };
        }

        const file = await uploadFile;

        try {
            const tracingInputs = await TracingBaseModel.parseUploadedFile(file, tStructureId);

            return UnregisteredTracing.createTracingParsedData(reconstructionId, tracingInputs, file.filename);
        } catch (err) {
            return {tracings: null, error: err};
        }
    }

    protected static async createTracingParsedData(reconstructionId: string, tracingInputs: ITracingDataInput[], source: string, insertOnly: boolean = false): Promise<IUploadOutput> {
        try {
            const promises: Promise<IUploadIntermediate>[] = tracingInputs.map(async (input) => {
                const swcData = input.input;

                const tracingStructureId = input.tracingStructureId;

                let tracing: UnregisteredTracing = null;

                // Reconstruction
                const reconstruction = await Reconstruction.findByPk(reconstructionId);

                // Only allow one axon/dendrite per reconstruction.
                const existing = await UnregisteredTracing.findOne({
                    where: {
                        reconstructionId: reconstruction.id,
                        tracingStructureId: tracingStructureId
                    }
                });

                if (existing) {
                    if (insertOnly) {
                        return {tracing: existing, error: null};
                    }

                    await UnregisteredTracing.deleteTracing(existing.id);
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

                let nodeData: UnregisteredTracingNodeMutationData[] = swcData.getSamples().map(sample => {
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

                await UnregisteredTracing.sequelize.transaction(async (t) => {
                    tracing = await UnregisteredTracing.create(tracingData, {transaction: t});

                    nodeData = nodeData.map(node => {
                        node.tracingId = tracing.id;
                        return node;
                    });

                    tracing.Nodes = await UnregisteredTracingNode.bulkCreate(nodeData, {transaction: t});
                });

                debug(`inserted ${nodeData.length} nodes from ${source}`);

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
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    UnregisteredTracing.init({
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
        endCount: DataTypes.INTEGER
    }, {
        tableName: "UnregisteredTracing",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    UnregisteredTracing.hasMany(UnregisteredTracingNode, {foreignKey: "tracingId", as: "Nodes"});
    UnregisteredTracing.belongsTo(TracingStructure, {foreignKey: "tracingStructureId"});
    UnregisteredTracing.belongsTo(Reconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
