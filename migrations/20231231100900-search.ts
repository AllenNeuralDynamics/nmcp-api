import {QueryInterface} from "sequelize";

import {BrainStructureTableName, NeuronTableName, SearchContentTable, SynchronizationMarkerTableName, TracingStructureTableName, TracingTableName} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {

        await queryInterface.createTable(
            SearchContentTable,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                somaX: Sequelize.DOUBLE,
                somaY: Sequelize.DOUBLE,
                somaZ: Sequelize.DOUBLE,
                nodeCount: Sequelize.INTEGER,
                somaCount: Sequelize.INTEGER,
                pathCount: Sequelize.INTEGER,
                branchCount: Sequelize.INTEGER,
                endCount: Sequelize.INTEGER,
                neuronIdString: Sequelize.TEXT,
                neuronDOI: Sequelize.TEXT,
                neuronConsensus: Sequelize.INTEGER,
                visibility: Sequelize.INTEGER,
                tracingId: {
                    type: Sequelize.UUID,
                    references: {
                        model: TracingTableName,
                        key: "id"
                    }
                },
                brainAreaId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
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
                tracingStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: TracingStructureTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SearchContentTable, ["neuronId"]);
        await queryInterface.addIndex(SearchContentTable, ["tracingId"]);
        await queryInterface.addIndex(SearchContentTable, ["brainAreaId"]);
        await queryInterface.addIndex(SearchContentTable, ["tracingStructureId"]);
        await queryInterface.addIndex(SearchContentTable, ["nodeCount"]);
        await queryInterface.addIndex(SearchContentTable, ["somaCount"]);
        await queryInterface.addIndex(SearchContentTable, ["pathCount"]);
        await queryInterface.addIndex(SearchContentTable, ["branchCount"]);
        await queryInterface.addIndex(SearchContentTable, ["endCount"]);
        await queryInterface.addIndex(SearchContentTable, ["neuronConsensus"]);

        await queryInterface.createTable(
            SynchronizationMarkerTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                markerKind: Sequelize.INTEGER,
                appliedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            }
        );

        await queryInterface.addIndex(SynchronizationMarkerTableName, ["markerKind"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(SynchronizationMarkerTableName);
        await queryInterface.dropTable(SearchContentTable);
    }
}
