import {QueryInterface} from "sequelize";

import {
    BrainStructureTableName,
    NeuronTableName,
    ReconstructionTableName,
    StructureIdentifierTableName,
    TracingNodeTableName,
    TracingStructureTableName,
    TracingTableName,
    UserTableName
} from "../models/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(ReconstructionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                status: Sequelize.INTEGER,
                notes: Sequelize.TEXT,
                checks: Sequelize.TEXT,
                durationHours: Sequelize.DOUBLE,
                lengthMillimeters: Sequelize.DOUBLE,
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
                proofreaderId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                startedAt: Sequelize.DATE,
                completedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.addIndex(ReconstructionTableName, ["status"]);

        await queryInterface.createTable(
            TracingTableName,
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
                nodeLookupAt: Sequelize.DATE,
                searchTransformAt: Sequelize.DATE,
                somaNodeId: {
                    type: Sequelize.UUID
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
                        model: ReconstructionTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(TracingTableName, ["reconstructionId"]);
        await queryInterface.addIndex(TracingTableName, ["tracingStructureId"]);

        await queryInterface.createTable(
            TracingNodeTableName,
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
                brainStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
                        key: "id"
                    }
                },
                tracingId: {
                    type: Sequelize.UUID,
                    references: {
                        model: "Tracing",
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(TracingNodeTableName, ["tracingId"]);
        await queryInterface.addIndex(TracingNodeTableName, ["brainStructureId"]);
        await queryInterface.addIndex(TracingNodeTableName, ["structureIdentifierId"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(ReconstructionTableName);
        await queryInterface.dropTable(TracingNodeTableName);
        await queryInterface.dropTable(TracingTableName);
    }
}
