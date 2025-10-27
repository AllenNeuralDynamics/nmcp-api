import {QueryInterface} from "sequelize";

import {CollectionTableName, SpecimenTableName} from "../models/tableNames";

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

        await queryInterface.addColumn(SpecimenTableName, "collectionId", {
            type: Sequelize.UUID,
            references: {
                model: CollectionTableName,
                key: "id"
            }
        });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.removeColumn(SpecimenTableName, "collectionId");
        await queryInterface.dropTable(CollectionTableName);
    }
}
