import {QueryInterface} from "sequelize";

import {
    AnnotationTableName,
    NeuronStructureTableName,
    NodeStructureTableName,
    RawReconstructionNodeTableName,
    RawReconstructionTableName,
    RawReconstructionUploadTableName,
    SpecimenNodeTableName,
    UserTableName
} from "../models/tableNames";

const UniqueAnnotationIndexName = "raw_reconstruction_annotation_id";
const UniqueAttemptIndexName = "raw_reconstruction_upload_annotation_attempt";
const SpecimenNodeReconstructionIndexName = "specimen_node_reconstruction_id";

export = {
    // One transaction each way: migrate.sh retries until db:migrate succeeds, and a half-applied run would fail every
    // retry after it.
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.createTable(
                RawReconstructionTableName,
                {
                    id: {
                        primaryKey: true,
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.literal("uuidv7()")
                    },
                    nodeCounts: {
                        type: Sequelize.JSONB,
                        allowNull: false
                    },
                    notes: {
                        type: Sequelize.TEXT,
                        defaultValue: ""
                    },
                    uploadedAt: {
                        type: Sequelize.DATE,
                        allowNull: false
                    },
                    annotationId: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: AnnotationTableName,
                            key: "id"
                        }
                    },
                    createdAt: Sequelize.DATE,
                    updatedAt: Sequelize.DATE,
                    deletedAt: Sequelize.DATE
                }, {transaction});

            await queryInterface.createTable(
                RawReconstructionNodeTableName,
                {
                    id: {
                        primaryKey: true,
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.literal("uuidv7()")
                    },
                    index: {
                        type: Sequelize.INTEGER,
                        defaultValue: -1
                    },
                    parentIndex: {
                        type: Sequelize.INTEGER,
                        defaultValue: -2
                    },
                    x: {
                        type: Sequelize.DOUBLE,
                        defaultValue: 0.0
                    },
                    y: {
                        type: Sequelize.DOUBLE,
                        defaultValue: 0.0
                    },
                    z: {
                        type: Sequelize.DOUBLE,
                        defaultValue: 0.0
                    },
                    radius: {
                        type: Sequelize.DOUBLE,
                        defaultValue: 0.0
                    },
                    lengthToParent: {
                        type: Sequelize.DOUBLE,
                        defaultValue: 0.0
                    },
                    nodeStructureId: {
                        type: Sequelize.UUID,
                        references: {
                            model: NodeStructureTableName,
                            key: "id"
                        }
                    },
                    neuronStructureId: {
                        type: Sequelize.UUID,
                        references: {
                            model: NeuronStructureTableName,
                            key: "id"
                        }
                    },
                    reconstructionId: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: RawReconstructionTableName,
                            key: "id"
                        }
                    },
                    createdAt: Sequelize.DATE,
                    updatedAt: Sequelize.DATE
                }, {transaction});

            // Added after the node table exists: the soma and reconstructionId foreign keys are circular.
            await queryInterface.addColumn(RawReconstructionTableName, "somaNodeId", {
                type: Sequelize.UUID,
                allowNull: true,
                references: {
                    model: RawReconstructionNodeTableName,
                    key: "id"
                }
            }, {transaction});

            await queryInterface.createTable(
                RawReconstructionUploadTableName,
                {
                    id: {
                        primaryKey: true,
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.literal("uuidv7()")
                    },
                    annotationId: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: AnnotationTableName,
                            key: "id"
                        }
                    },
                    attemptNumber: {
                        type: Sequelize.INTEGER,
                        allowNull: false
                    },
                    status: {
                        type: Sequelize.INTEGER,
                        allowNull: false
                    },
                    userId: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: UserTableName,
                            key: "id"
                        }
                    },
                    sourceFilename: {
                        type: Sequelize.TEXT,
                        allowNull: false,
                        defaultValue: ""
                    },
                    format: {
                        type: Sequelize.INTEGER,
                        allowNull: false
                    },
                    failureMessage: {
                        type: Sequelize.TEXT,
                        defaultValue: null
                    },
                    createdAt: Sequelize.DATE,
                    updatedAt: Sequelize.DATE,
                    deletedAt: Sequelize.DATE
                }, {transaction});

            await queryInterface.addIndex(RawReconstructionTableName, ["annotationId"], {name: UniqueAnnotationIndexName, unique: true, transaction});

            await queryInterface.addIndex(RawReconstructionNodeTableName, ["reconstructionId"], {transaction});

            await queryInterface.addIndex(RawReconstructionUploadTableName, ["annotationId", "attemptNumber"], {name: UniqueAttemptIndexName, unique: true, transaction});

            // The raw upload refuses an annotation whose specimen-space reconstruction has nodes, and looks them up by
            // this column.
            await queryInterface.addIndex(SpecimenNodeTableName, ["reconstructionId"], {name: SpecimenNodeReconstructionIndexName, transaction});
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.removeIndex(SpecimenNodeTableName, SpecimenNodeReconstructionIndexName, {transaction});

            await queryInterface.dropTable(RawReconstructionUploadTableName, {transaction});

            await queryInterface.removeIndex(RawReconstructionTableName, UniqueAnnotationIndexName, {transaction});

            await queryInterface.removeColumn(RawReconstructionTableName, "somaNodeId", {transaction});

            await queryInterface.dropTable(RawReconstructionNodeTableName, {transaction});

            await queryInterface.dropTable(RawReconstructionTableName, {transaction});
        });
    }
};
