import {QueryInterface} from "sequelize";

import {
    AtlasStructureTableName,
    AtlasTableName,
    CollectionTableName,
    FluorophoreTableName,
    GenotypeTableName,
    InjectionTableName,
    InjectionVirusTableName,
    NeuronTableName,
    SpecimenTableName
} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            CollectionTableName,
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
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            GenotypeTableName,
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

        await queryInterface.createTable(
            InjectionVirusTableName,
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

        await queryInterface.createTable(
            FluorophoreTableName,
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

        await queryInterface.createTable(
            SpecimenTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                label: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                referenceDate: Sequelize.DATE,
                keywords: {
                    type: Sequelize.JSONB,
                    defaultValue: []
                },
                notes: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                somaProperties: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                tomography: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                genotypeId: {
                    type: Sequelize.UUID,
                    references: {
                        model: GenotypeTableName,
                        key: "id"
                    }
                },
                atlasId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasTableName,
                        key: "id"
                    },
                    allowNull: false
                },
                collectionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: CollectionTableName,
                        key: "id"
                    },
                    allowNull: false
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            InjectionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                atlasStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasStructureTableName,
                        key: "id"
                    }
                },
                fluorophoreId: {
                    type: Sequelize.UUID,
                    references: {
                        model: FluorophoreTableName,
                        key: "id"
                    }
                },
                injectionVirusId: {
                    type: Sequelize.UUID,
                    references: {
                        model: InjectionVirusTableName,
                        key: "id"
                    }
                },
                specimenId: {
                    type: Sequelize.UUID,
                    references: {
                        model: SpecimenTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            NeuronTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.literal("uuidv7()")
                },
                label: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                keywords: {
                    type: Sequelize.JSONB,
                    defaultValue: []
                },
                specimenSoma: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                atlasSoma: {
                    type: Sequelize.JSONB,
                    defaultValue: null
                },
                somaProperties: {
                    type: Sequelize.JSONB,
                    defaultValue: null,
                },
                atlasStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: AtlasStructureTableName,
                        key: "id"
                    }
                },
                specimenId: {
                    type: Sequelize.UUID,
                    references: {
                        model: SpecimenTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SpecimenTableName, ["collectionId"]);
        await queryInterface.addIndex(NeuronTableName, ["specimenId"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(NeuronTableName);
        await queryInterface.dropTable(InjectionTableName);
        await queryInterface.dropTable(SpecimenTableName);
        await queryInterface.dropTable(FluorophoreTableName);
        await queryInterface.dropTable(InjectionVirusTableName);
        await queryInterface.dropTable(GenotypeTableName);
        await queryInterface.dropTable(CollectionTableName);
    }
}
