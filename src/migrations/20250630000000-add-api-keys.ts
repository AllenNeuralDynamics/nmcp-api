import {QueryInterface} from "sequelize";

import {ApiKeyTableName, UserTableName} from "../models/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            ApiKeyTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                permissions: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                expiration: {
                    type: Sequelize.DATE
                },
                description: Sequelize.TEXT,
                userId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.dropTable(ApiKeyTableName);
    }
}
