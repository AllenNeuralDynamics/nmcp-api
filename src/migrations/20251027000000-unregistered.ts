import {QueryInterface} from "sequelize";

import {
    StructureIdentifierTableName,
    TracingStructureTableName,
    ReconstructionTableName,
    UnregisteredTracingTableName,
    UnregisteredNodeTableName,
    UnregisteredReconstructionTableName, NeuronTableName, UserTableName
} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.dropTable(UnregisteredNodeTableName);
        await queryInterface.dropTable(UnregisteredTracingTableName);

        await queryInterface.createTable(
            UnregisteredReconstructionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                sourceUrl: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                sourceComments: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                status: Sequelize.INTEGER,
                annotatorId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                startedAt: Sequelize.DATE,
                completedAt: Sequelize.DATE,
                notes: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                checks: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                durationHours:  {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                lengthMillimeters: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
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
                neuronId: {
                    type: Sequelize.UUID,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(UnregisteredReconstructionTableName, ["neuronId"]);

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
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(UnregisteredNodeTableName, ["reconstructionId"]);

        await queryInterface.addColumn(ReconstructionTableName,
            "unregisteredId", {
                type: Sequelize.UUID,
                allowNull: true,
                defaultValue: null,
                references: {
                    model: UnregisteredReconstructionTableName,
                    key: "id"
                }
            }
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(ReconstructionTableName, "unregisteredId")
        await queryInterface.dropTable(UnregisteredReconstructionTableName);
    }
}
