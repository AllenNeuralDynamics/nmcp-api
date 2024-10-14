import {QueryInterface} from "sequelize";

import {
    BrainStructureTableName,
    FluorophoreTableName,
    GenotypeTableName,
    InjectionTableName,
    InjectionVirusTableName,
    NeuronTableName,
    SampleTableName,
    StructureIdentifierTableName,
    TracingStructureTableName,
    UserTableName
} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.createTable(
            BrainStructureTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                structureId: Sequelize.INTEGER,
                atlasId: Sequelize.INTEGER,
                graphId: Sequelize.INTEGER,
                graphOrder: Sequelize.INTEGER,
                hemisphereId: Sequelize.INTEGER,
                depth: Sequelize.INTEGER,
                parentStructureId: Sequelize.INTEGER,
                structureIdPath: Sequelize.TEXT,
                name: Sequelize.TEXT,
                safeName: Sequelize.TEXT,
                aliases: Sequelize.TEXT,
                geometryFile: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                geometryColor: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                geometryEnable: {
                    type: Sequelize.BOOLEAN,
                    defaultValue: false
                },
                acronym: Sequelize.TEXT,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(BrainStructureTableName, ["depth"]);
        await queryInterface.addIndex(BrainStructureTableName, ["parentStructureId"]);

        await queryInterface.createTable(
            GenotypeTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                name: Sequelize.TEXT,
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
                    defaultValue: Sequelize.UUIDV4
                },
                name: Sequelize.TEXT,
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
                    defaultValue: Sequelize.UUIDV4
                },
                name: Sequelize.TEXT,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            SampleTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                idNumber: {
                    type: Sequelize.INTEGER,
                    defaultValue: -1
                },
                tag: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                animalId: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                comment: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                sampleDate: Sequelize.DATE,
                visibility: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                mouseStrainId: {
                    type: Sequelize.UUID,
                    references: {
                        model: GenotypeTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SampleTableName, ["visibility"]);
        await queryInterface.addIndex(SampleTableName, ["mouseStrainId"]);

        await queryInterface.createTable(
            InjectionTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                brainAreaId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
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
                sampleId: {
                    type: Sequelize.UUID,
                    references: {
                        model: SampleTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(InjectionTableName, ["fluorophoreId"]);
        await queryInterface.addIndex(InjectionTableName, ["injectionVirusId"]);
        await queryInterface.addIndex(InjectionTableName, ["sampleId"]);

        await queryInterface.createTable(
            NeuronTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                idNumber: {
                    type: Sequelize.INTEGER,
                    defaultValue: -1
                },
                idString: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                tag: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                keywords: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                doi: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                x: {
                    type: Sequelize.DOUBLE,
                    defaultValue: 0
                },
                y: {
                    type: Sequelize.DOUBLE,
                    defaultValue: 0
                },
                z: {
                    type: Sequelize.DOUBLE,
                    defaultValue: 0
                },
                visibility: {
                    type: Sequelize.INTEGER,
                    defaultValue: 1
                },
                consensus: {
                    type: Sequelize.INTEGER,
                    defaultValue: 1
                },
                metadata: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                brainStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
                        key: "id"
                    }
                },
                sampleId: {
                    type: Sequelize.UUID,
                    references: {
                        model: SampleTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(NeuronTableName, ["consensus"]);
        await queryInterface.addIndex(NeuronTableName, ["visibility"]);
        await queryInterface.addIndex(NeuronTableName, ["brainStructureId"]);
        await queryInterface.addIndex(NeuronTableName, ["sampleId"]);

        await queryInterface.createTable(
            StructureIdentifierTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                name: Sequelize.TEXT,
                swcName: Sequelize.TEXT,
                value: Sequelize.INTEGER,
                mutable: {type: Sequelize.BOOLEAN, defaultValue: true},
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(
            TracingStructureTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                name: Sequelize.TEXT,
                value: Sequelize.INTEGER,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.createTable(UserTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                authDirectoryId: Sequelize.TEXT,
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
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(UserTableName);

        await queryInterface.dropTable(StructureIdentifierTableName);
        await queryInterface.dropTable(TracingStructureTableName);

        await queryInterface.dropTable(NeuronTableName);
        await queryInterface.dropTable(SampleTableName);
        await queryInterface.dropTable(GenotypeTableName);
        await queryInterface.dropTable(BrainStructureTableName);
    }
};
