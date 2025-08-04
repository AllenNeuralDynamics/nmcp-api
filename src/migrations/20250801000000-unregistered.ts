import {QueryInterface} from "sequelize";

import {
    NeuronTableName,
    StructureIdentifierTableName,
    TracingStructureTableName,
    UnregisteredReconstructionTableName,
    UnregisteredTracingTableName,
    UnregisteredNodeTableName,
    UserTableName
} from "../models/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(UnregisteredReconstructionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                status: Sequelize.INTEGER,
                notes: Sequelize.TEXT,
                neuronId: {
                    type: Sequelize.UUID,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                annotatorId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.addIndex(UnregisteredReconstructionTableName, ["status"]);

        await queryInterface.createTable(
            UnregisteredTracingTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                filename: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                // comment lines found in SWC file
                fileComments: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                nodeCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                pathCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                branchCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                endCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                tracingStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: TracingStructureTableName,
                        key: "id"
                    }
                },
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UnregisteredReconstructionTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(UnregisteredTracingTableName, ["reconstructionId"]);
        await queryInterface.addIndex(UnregisteredTracingTableName, ["tracingStructureId"]);

        await queryInterface.createTable(
            UnregisteredNodeTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                sampleNumber: Sequelize.INTEGER,
                parentNumber: Sequelize.INTEGER,
                x: Sequelize.DOUBLE,
                y: Sequelize.DOUBLE,
                z: Sequelize.DOUBLE,
                radius: Sequelize.DOUBLE,
                lengthToParent: Sequelize.DOUBLE,
                structureIdentifierId: {
                    type: Sequelize.UUID,
                    references: {
                        model: StructureIdentifierTableName,
                        key: "id"
                    }
                },
                tracingId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UnregisteredTracingTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(UnregisteredNodeTableName, ["tracingId"]);
        await queryInterface.addIndex(UnregisteredNodeTableName, ["brainStructureId"]);
        await queryInterface.addIndex(UnregisteredNodeTableName, ["structureIdentifierId"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(UnregisteredReconstructionTableName);
        await queryInterface.dropTable(UnregisteredTracingTableName);
        await queryInterface.dropTable(UnregisteredNodeTableName);
    }
}
