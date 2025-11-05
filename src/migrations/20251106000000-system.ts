import {QueryInterface} from "sequelize";

import {
    ServiceHistoryTableName,
    SynchronizationMarkerTableName,
    SystemDefinitionTableName, SystemErrorTableName,
    UserTableName
} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            SystemDefinitionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                keywords: {
                    type: Sequelize.JSONB,
                    defaultValue: {neuron: []}
                },
                qualityControl: {
                    type: Sequelize.JSONB,
                    defaultValue: {errorsAsWarnings: []}
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            SynchronizationMarkerTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                markerKind: Sequelize.INTEGER,
                appliedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            }
        );

        await queryInterface.createTable(
            SystemErrorTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                source: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                sourceName: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                kind: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                description: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                details: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.createTable(
            ServiceHistoryTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                source: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                sourceName: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                kind: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                description: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                details: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.createTable(
            UserTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                authDirectoryId: Sequelize.TEXT,
                crossAuthenticationId: Sequelize.TEXT,
                firstName: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                lastName: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                emailAddress: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                affiliation: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                permissions: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                isAnonymousForAnnotate: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false
                },
                isAnonymousForPublish: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false
                },
                isSystemUser: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false
                },
                settings: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                favorites: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(UserTableName);
        await queryInterface.dropTable(ServiceHistoryTableName);
        await queryInterface.dropTable(SystemErrorTableName);
        await queryInterface.dropTable(SynchronizationMarkerTableName);
        await queryInterface.dropTable(SystemDefinitionTableName);
    }
}
