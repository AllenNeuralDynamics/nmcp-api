import {QueryInterface} from "sequelize";

import {
    AtlasNodeTableName,
    AtlasReconstructionTableName,
    AtlasStructureTableName,
    NeuronStructureTableName,
    NeuronTableName,
    NodeStructureTableName,
    SpecimenSpacePrecomputedTableName,
    PrecomputedTableName,
    QualityControlTableName,
    SpecimenNodeTableName,
    ReconstructionTableName,
    UserTableName
} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            ReconstructionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                sourceUrl: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                sourceComments: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                status: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                notes: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                durationHours: {
                    type: Sequelize.DOUBLE,
                    defaultValue: null
                },
                specimenLengthMillimeters: {
                    type: Sequelize.DOUBLE,
                    defaultValue: null
                },
                specimenNodeCounts: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                annotatorId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                reviewerId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                neuronId: {
                    type: Sequelize.UUID,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                startedAt: Sequelize.DATE,
                completedAt: Sequelize.DATE,
                reviewedAt: Sequelize.DATE,
                approvedAt: Sequelize.DATE,
                publishedAt: Sequelize.DATE,
                archivedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            SpecimenNodeTableName,
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
                    references: {
                        model: ReconstructionTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addColumn(ReconstructionTableName, "specimenSomaNodeId", {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
                model: SpecimenNodeTableName,
                key: "id"
            }
        });

        await queryInterface.createTable(
            AtlasReconstructionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                sourceUrl: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                sourceComments: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                status: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                lengthMillimeters: {
                    type: Sequelize.DOUBLE,
                    defaultValue: null
                },
                nodeCounts: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                doi: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                reviewerId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
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
                //qualityControlAt: Sequelize.DATE, Not needed, have an actual QC object w/dates.
                nodeStructureAssignmentAt: Sequelize.DATE,
                //precomputedAt: Sequelize.DATE, Not needed, have an actual Precomputed object w/dates.
                searchIndexedAt: Sequelize.DATE,
                publishedAt: Sequelize.DATE, // Possibly a different date than when the parent reconstruction was originally published, if a new revision.
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            AtlasNodeTableName,
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
                manualAtlasAssigment: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false
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
                atlasStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasStructureTableName,
                        key: "id"
                    }
                },
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasReconstructionTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addColumn(AtlasReconstructionTableName, "somaNodeId", {
            type: Sequelize.UUID,
            allowNull: true,
            references: {
                model: AtlasNodeTableName,
                key: "id"
            }
        });

        await queryInterface.createTable(
            QualityControlTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                status: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                current: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                history: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasReconstructionTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            SpecimenSpacePrecomputedTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                skeletonId: {
                    type: Sequelize.INTEGER,
                    autoIncrement: true,
                    allowNull: false,
                    unique: true
                },
                status: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                version: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                location: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: ReconstructionTableName,
                        key: "id"
                    }
                },
                generatedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            PrecomputedTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                skeletonId: {
                    type: Sequelize.INTEGER,
                    autoIncrement: true,
                    allowNull: false,
                    unique: true
                },
                status: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                version: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                location: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasReconstructionTableName,
                        key: "id"
                    }
                },
                generatedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(ReconstructionTableName, ["status"]);
        await queryInterface.addIndex(ReconstructionTableName, ["neuronId"]);
        await queryInterface.addIndex(ReconstructionTableName, ["annotatorId"]);
        await queryInterface.addIndex(AtlasReconstructionTableName, ["status"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(PrecomputedTableName);
        await queryInterface.dropTable(QualityControlTableName);
        await queryInterface.removeColumn(AtlasReconstructionTableName, "somaNodeId");
        await queryInterface.dropTable(AtlasNodeTableName);
        await queryInterface.dropTable(AtlasReconstructionTableName);
        await queryInterface.removeColumn(ReconstructionTableName, "somaNodeId");
        await queryInterface.dropTable(SpecimenNodeTableName);
        await queryInterface.dropTable(ReconstructionTableName);
    }
}
