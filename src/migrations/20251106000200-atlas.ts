import {QueryInterface} from "sequelize";

import {AtlasKindTableName, AtlasStructureTableName, AtlasTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(AtlasKindTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                kind: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                family: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                name: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                description: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.createTable(AtlasTableName,
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
                description: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                reference: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                spatialUrl: {
                    type: Sequelize.TEXT,
                    defaultValue: null
                },
                geometryUrl: {
                    type: Sequelize.TEXT,
                    defaultValue: null
                },
                rootStructureId: {
                    type: Sequelize.INTEGER,
                    defaultValue: null
                },
                atlasKindId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasKindTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.createTable(
            AtlasStructureTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                internalId: {
                    type: Sequelize.INTEGER,
                    defaultValue: -1
                },
                structureId: {
                    type: Sequelize.INTEGER,
                    defaultValue: -1
                },
                parentStructureId: {
                    type: Sequelize.INTEGER,
                    defaultValue: -1
                },
                name: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                safeName: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                acronym: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                aliases: {
                    type: Sequelize.JSONB,
                    defaultValue: []
                },
                structureIdPath: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                depth: {
                    type: Sequelize.INTEGER,
                    defaultValue: -1
                },
                defaultColor: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                hasGeometry: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false
                },
                atlasId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(AtlasStructureTableName);
        await queryInterface.dropTable(AtlasTableName);
        await queryInterface.dropTable(AtlasKindTableName);
    }
}
