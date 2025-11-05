import {QueryInterface} from "sequelize";

import {NeuronStructureTableName, NodeStructureTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            NodeStructureTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                name: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                swcValue: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            NeuronStructureTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                name: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(NeuronStructureTableName);
        await queryInterface.dropTable(NodeStructureTableName);
    }
}
