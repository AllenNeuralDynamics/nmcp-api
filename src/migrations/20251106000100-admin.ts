import {QueryInterface} from "sequelize";

import {
    AccessRequestTableName,
    ApiKeyTableName,
    IssueNoteTableName,
    IssueTableName,
    UserTableName
} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            AccessRequestTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
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
                purpose: {
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
                adminId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                assignedId: {
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
            }
        );

        await queryInterface.createTable(
            IssueTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                issueId: {
                    type: Sequelize.INTEGER,
                    autoIncrement: true,
                    allowNull: false,
                    unique: true
                },
                kind: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                status: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                description: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                resolution: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                resolutionKind: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                references: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                authorId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                responderId: {
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


        await queryInterface.createTable(
            IssueNoteTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                notes: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                authorId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                issueId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: IssueTableName,
                        key: "id"
                    }
                },

                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            ApiKeyTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                key: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                permissions: {
                    type: Sequelize.INTEGER,
                    allowNull: false,
                    defaultValue: 0
                },
                expiration: {
                    type: Sequelize.DATE
                },
                description: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
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

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(ApiKeyTableName);
        await queryInterface.dropTable(IssueNoteTableName);
        await queryInterface.dropTable(IssueTableName);
        await queryInterface.dropTable(AccessRequestTableName);
    }
}
