const BrainStructureTableName = "BrainStructure";
const SyncHistoryTableName = "SyncHistory";

export = {
    up: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.createTable(
            "InjectionViruses",
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
            "Fluorophores",
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
            "MouseStrains",
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
            "Samples",
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
                animalId: Sequelize.TEXT,
                tag: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                comment: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                sampleDate: Sequelize.DATE,
                mouseStrainId: {
                    type: Sequelize.UUID,
                    references: {
                        model: "MouseStrains",
                        key: "id"
                    }
                },
                visibility: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex("Samples", ["mouseStrainId"]);

        await queryInterface.createTable(
            "Injections",
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
                        model: "Fluorophores",
                        key: "id"
                    }
                },
                injectionVirusId: {
                    type: Sequelize.UUID,
                    references: {
                        model: "InjectionViruses",
                        key: "id"
                    }
                },
                sampleId: {
                    type: Sequelize.UUID,
                    references: {
                        model: "Samples",
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex("Injections", ["fluorophoreId"]);
        await queryInterface.addIndex("Injections", ["injectionVirusId"]);
        await queryInterface.addIndex("Injections", ["sampleId"]);

        await queryInterface.createTable(
            "Neurons",
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
                brainAreaId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
                        key: "id"
                    }
                },
                injectionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: "Injections",
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex("Neurons", ["brainAreaId"]);
        await queryInterface.addIndex("Neurons", ["injectionId"]);

        await queryInterface.createTable(
            SyncHistoryTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                kind: Sequelize.INTEGER,
                entity: Sequelize.UUID,
                status: Sequelize.INTEGER,
                error: Sequelize.TEXT,
                startedAt:Sequelize.DATE,
                completedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SyncHistoryTableName, ["kind"]);

    },

    down: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.dropTable("Neurons");
        await queryInterface.dropTable("Injections");
        await queryInterface.dropTable("Samples");
        await queryInterface.dropTable("MouseStrains");
        await queryInterface.dropTable(BrainStructureTableName);
        await queryInterface.dropTable("InjectionViruses");
        await queryInterface.dropTable("Fluorophores");
        await queryInterface.dropTable(SyncHistoryTableName);
    }
};
