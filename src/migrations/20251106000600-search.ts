import {QueryInterface} from "sequelize";

import {
    AtlasKindTableName,
    AtlasReconstructionTableName,
    AtlasStructureTableName, AtlasTableName, CollectionTableName,
    NeuronStructureTableName,
    NeuronTableName,
    SearchIndexTableName,
} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            SearchIndexTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                somaX: {
                    type: Sequelize.DOUBLE,
                    defaultValue: 0.0
                },
                somaY: {
                    type: Sequelize.DOUBLE,
                    defaultValue: 0.0
                },
                somaZ: {
                    type: Sequelize.DOUBLE,
                    defaultValue: 0.0
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
                neuronLabel: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                doi: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                atlasKindId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasKindTableName,
                        key: "id"
                    }
                },
                atlasId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasTableName,
                        key: "id"
                    }
                },
                collectionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: CollectionTableName,
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
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasReconstructionTableName,
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
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SearchIndexTableName, ["nodeCount"]);
        await queryInterface.addIndex(SearchIndexTableName, ["pathCount"]);
        await queryInterface.addIndex(SearchIndexTableName, ["branchCount"]);
        await queryInterface.addIndex(SearchIndexTableName, ["endCount"]);
        await queryInterface.addIndex(SearchIndexTableName, ["neuronLabel"]);
        await queryInterface.addIndex(SearchIndexTableName, ["atlasKindId"]);
        await queryInterface.addIndex(SearchIndexTableName, ["atlasId"]);
        await queryInterface.addIndex(SearchIndexTableName, ["collectionId"]);
        await queryInterface.addIndex(SearchIndexTableName, ["neuronId"]);
        await queryInterface.addIndex(SearchIndexTableName, ["reconstructionId"]);
        await queryInterface.addIndex(SearchIndexTableName, ["atlasStructureId"]);
        await queryInterface.addIndex(SearchIndexTableName, ["neuronStructureId"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(SearchIndexTableName);
    }
}
