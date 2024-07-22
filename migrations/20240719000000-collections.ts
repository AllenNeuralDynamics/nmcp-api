import {QueryInterface} from "sequelize";

import {CollectionTableName, SampleTableName} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            CollectionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                name: Sequelize.TEXT,
                description: Sequelize.TEXT,
                reference: Sequelize.TEXT,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addColumn(SampleTableName, "collectionId", {
            type: Sequelize.UUID,
            references: {
                model: CollectionTableName,
                key: "id"
            }
        });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.removeColumn(SampleTableName, "collectionId");
        await queryInterface.dropTable(CollectionTableName);
    }
}
