import {QueryInterface} from "sequelize";

const NeuronTableName = "Neuron";

const UserTableName = "User";
const AnnotationTableName = "Annotation";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(UserTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                firstName: Sequelize.TEXT,
                lastName: Sequelize.TEXT,
                emailAddress: Sequelize.TEXT,
                affiliation: Sequelize.TEXT,
                permissions: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                isAnonymousForComplete: Sequelize.BOOLEAN,
                isAnonymousForCandidate: Sequelize.BOOLEAN,
                crossAuthenticationId: Sequelize.TEXT,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.createTable(AnnotationTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                status: Sequelize.INTEGER,
                notes: Sequelize.TEXT,
                durationMinutes: Sequelize.INTEGER,
                neuronId: {
                    type: Sequelize.UUID,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                annotatorId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                proofreaderId: {
                    type: Sequelize.UUID,
                    references: {
                        model: UserTableName,
                        key: "id"
                    }
                },
                startedAt: Sequelize.DATE,
                completedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            }
        );

        await queryInterface.addIndex(AnnotationTableName, ["status"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(AnnotationTableName);
        await queryInterface.dropTable(UserTableName);
    }
}