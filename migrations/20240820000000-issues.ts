import {QueryInterface} from "sequelize";

import {IssueTableName, NeuronTableName, ReconstructionTableName, UserTableName} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            IssueTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
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
                description: Sequelize.TEXT,
                response: Sequelize.TEXT,
                creatorId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                neuronId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                reconstructionId: {
                    type: Sequelize.UUID,
                    allowNull: true,
                    references: {
                        model: ReconstructionTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.dropTable(IssueTableName);
    }
}
