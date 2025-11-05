import {QueryInterface} from "sequelize";

import {EventLogItemTableName, UserTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            EventLogItemTableName, {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                kind: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                name: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                details: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                userId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                substituteUserId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                targetId: Sequelize.UUID,
                parentId: Sequelize.UUID,
                references: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                createdAt: Sequelize.DATE
            });
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(EventLogItemTableName);
    }
}
