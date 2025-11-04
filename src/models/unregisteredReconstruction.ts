import {DataTypes, Sequelize, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";

import {ParsedReconstruction, parseJsonFile, parseSwcFiles} from "../io/parsedReconstruction";
import {createUnregisteredReconstructionNodeInput, UnregisteredReconstructionNode, UnregisteredReconstructionNodeInput} from "./unregisteredReconstructionNode";
import {Neuron} from "./neuron";
import {User} from "./user";
import {IUploadFile, UnregisteredReconstructionUploadOutput} from "../graphql/secureResolvers";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Reconstruction} from "./reconstruction";
import {sum} from "../util/objectUtil";

const debug = require("debug")("nmcp:nmcp-api:unregistered-reconstruction");

export class UnregisteredReconstruction extends BaseModel {

    public sourceUrl: string;
    public sourceComments: string;

    // public getNodes!: HasManyGetAssociationsMixin<UnregisteredReconstructionNode>

    public Nodes?: UnregisteredReconstructionNode[];

    public static async fromJsonUpload(neuronId: string, uploadFile: Promise<IUploadFile>, reconstructionId: string): Promise<UnregisteredReconstructionUploadOutput> {
        if (!uploadFile) {
            return {
                reconstruction: null,
                error: {name: "UploadUnregisteredReconstructionError", message: "There are no files attached to parse."}
            };
        }

        if (!neuronId) {
            return {
                reconstruction: null,
                error: {name: "UploadUnregisteredReconstructionError", message: "The neuron id is empty."}
            };
        }

        try {
            const neuron = await Neuron.findByPk(neuronId);

            if (!neuron) {
                return {
                    reconstruction: null,
                    error: {name: "UploadUnregisteredReconstructionError", message: `Neuron ${neuronId} not found.`}
                };
            }

            const file = await uploadFile;

            const reconstructionData = await parseJsonFile(file);

            return UnregisteredReconstruction.fromParsedStructures(neuronId, reconstructionData, reconstructionId);
        } catch (err) {
            return {reconstruction: null, error: {name: "UploadUnregisteredReconstructionError", message: err.message}}
        }
    }

    public static async fromSwcUpload(neuronId: string, axonFile: Promise<IUploadFile>, dendriteFile: Promise<IUploadFile>, reconstructionId: string): Promise<UnregisteredReconstructionUploadOutput> {
        if (!axonFile || !dendriteFile) {
            return {
                reconstruction: null,
                error: {name: "UploadUnregisteredReconstructionError", message: "An axon and dendrite SWC must be attached."}
            };
        }

        if (!neuronId) {
            return {
                reconstruction: null,
                error: {name: "UploadUnregisteredReconstructionError", message: "The neuron id is empty."}
            };
        }

        try {

            const neuron = await Neuron.findByPk(neuronId);

            if (!neuron) {
                return {
                    reconstruction: null,
                    error: {name: "UploadUnregisteredReconstructionError", message: `Neuron ${neuronId} not found.`}
                };
            }

            const axonData = await axonFile;
            const dendriteData = await dendriteFile;

            const reconstructionData = await parseSwcFiles(axonData, dendriteData);

            if (reconstructionData.axon == null || reconstructionData.dendrite == null) {
                return {
                    reconstruction: null,
                    error: {
                        name: "UploadUnregisteredReconstructionError",
                        message: `${axonData ? "" : "Axon data is missing.  "}${dendriteData ? "" : "Dendrite data is missing."}`
                    }
                };
            }

            return UnregisteredReconstruction.fromParsedStructures(neuronId, reconstructionData, reconstructionId);
        } catch (err) {
            return {reconstruction: null, error: {name: "UploadUnregisteredReconstructionError", message: err.message}}
        }
    }

    private static async fromParsedStructures(neuronId: string, reconstructionData: ParsedReconstruction, reconstructionId: string): Promise<UnregisteredReconstructionUploadOutput> {
        let deleteFcn = null;

        try {
            let reconstruction = null;

            if (reconstructionId) {
                reconstruction = await UnregisteredReconstruction.findByPk(reconstructionId);

                if (!reconstruction) {
                    return {
                        reconstruction: null,
                        error: {name: "UploadUnregisteredReconstructionError", message: `Reconstruction ${reconstructionId} not found.`}
                    };
                }

                if (reconstruction.neuronId != neuronId) {
                    return {
                        reconstruction: null,
                        error: {
                            name: "UploadUnregisteredReconstructionError",
                            message: `Reconstruction ${reconstructionId} is not associated with neuron ${neuronId}.`
                        }
                    };
                }

                deleteFcn = async (t: Transaction) => {
                    await UnregisteredReconstructionNode.destroy({
                        where: {reconstructionId: reconstruction.id},
                        transaction: t
                    });
                }
            }

            const structures = [reconstructionData.axon, reconstructionData.dendrite];

            const nodeCount = sum(structures, s => s.nodeCount);
            const pathCount = sum(structures, s => s.pathCount);
            const branchCount = sum(structures, s => s.branchCount);
            const endCount = sum(structures, s => s.endCount);

            const findReconstruction = async (reconstruction: UnregisteredReconstruction, t: Transaction): Promise<UnregisteredReconstruction> => {
                if (!reconstruction) {
                    reconstruction = await UnregisteredReconstruction.create({
                        neuronId: neuronId
                    }, {transaction: t});
                }

                await reconstruction.update({
                    sourceUrl: reconstructionData.source,
                    sourceComments: reconstructionData.comments,
                    status: ReconstructionStatus.Unknown,
                    nodeCount: nodeCount,
                    pathCount: pathCount,
                    branchCount: branchCount,
                    endCount: endCount
                }, {transaction: t});

                return reconstruction;
            }

            const somas = structures.map(p => p.getNodes().find(n => n.parentNumber == -1)).filter(n => n);

            if (somas.length == 0) {
                return {
                    reconstruction: null,
                    error: {
                        name: "UploadUnregisteredReconstructionError",
                        message: "A soma was not found in the uploaded file."
                    }
                };
            }

            const createNodes = async (reconstruction: UnregisteredReconstruction, t: Transaction): Promise<void> => {
                const promises = structures.map(async (p) => {
                    const nodeData: UnregisteredReconstructionNodeInput[] = p.getNodes().map(node => createUnregisteredReconstructionNodeInput(node, p.NeuronStructureId, reconstruction.id));

                    const chunkSize = 100000;

                    for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                        await UnregisteredReconstructionNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction: t});
                    }
                });

                for (const p of promises) {
                    await p
                }
            }

            await UnregisteredReconstruction.sequelize.transaction(async (t) => {
                if (deleteFcn) {
                    await deleteFcn(t);
                }

                reconstruction = await findReconstruction(reconstruction, t);

                await createNodes(reconstruction, t);
            });

            debug(`created ${nodeCount} nodes`);

            return {reconstruction: reconstruction, error: null}; // UnregisteredReconstruction.fromParsedStructures(neuronId, parsedStructures, file.filename);
        } catch (err) {
            return {reconstruction: null, error: err};
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    UnregisteredReconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        sourceUrl: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        // comment lines found in SWC file
        sourceComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        status: DataTypes.INTEGER,
        notes: DataTypes.TEXT,
        checks: DataTypes.TEXT,
        durationHours: DataTypes.DOUBLE,
        lengthMillimeters: DataTypes.DOUBLE,
        nodeCount: DataTypes.INTEGER,
        pathCount: DataTypes.INTEGER,
        branchCount: DataTypes.INTEGER,
        endCount: DataTypes.INTEGER,
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE
    }, {
        tableName: "UnregisteredReconstruction",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    UnregisteredReconstruction.belongsTo(Neuron, {foreignKey: "neuronId", as: "Neuron"});
    UnregisteredReconstruction.belongsTo(User, {foreignKey: "annotatorId", as: "Annotator"});
    UnregisteredReconstruction.hasMany(UnregisteredReconstructionNode, {foreignKey: "reconstructionId", as: "Nodes"});
    UnregisteredReconstruction.hasMany(Reconstruction, {foreignKey: "unregisteredId", as: "Reconstructions"});
};
