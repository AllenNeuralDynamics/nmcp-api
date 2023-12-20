import {QueryInterface} from "sequelize";

const BrainStructureTableName = "BrainStructure";
const GenotypeTableName = "Genotype";
const FluorophoreTableName = "Fluorophore";
const InjectionVirusTableName = "InjectionVirus";
const SampleTableName = "Sample";
const InjectionTableName = "Injection";
const NeuronTableName = "Neuron";

const StructureIdentifierTableName = "StructureIdentifier";
const TracingStructureTableName = "TracingStructure";
const TracingTableName = "Tracing";
const TracingNodeTableName = "TracingNode";

const SearchContentTable = "SearchContent";

const SynchronizationMarkerTableName = "SynchronizationMarker";

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

        await queryInterface.createTable(
            TracingTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                filename: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                // comment lines found in SWC file
                fileComments: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                annotator: {
                    type: Sequelize.TEXT,
                    defaultValue: ""
                },
                nodeCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                pathCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                branchCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                endCount: {
                    type: Sequelize.INTEGER,
                    defaultValue: 0
                },
                nodeLookupAt: Sequelize.DATE,
                searchTransformAt: Sequelize.DATE,
                somaNodeId: {
                    type: Sequelize.UUID
                },
                tracingStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: TracingStructureTableName,
                        key: "id"
                    }
                },
                neuronId: {
                    type: Sequelize.UUID,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(TracingTableName, ["neuronId"]);
        await queryInterface.addIndex(TracingTableName, ["tracingStructureId"]);

        await queryInterface.createTable(
            TracingNodeTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                sampleNumber: Sequelize.INTEGER,
                parentNumber: Sequelize.INTEGER,
                x: Sequelize.DOUBLE,
                y: Sequelize.DOUBLE,
                z: Sequelize.DOUBLE,
                radius: Sequelize.DOUBLE,
                lengthToParent: Sequelize.DOUBLE,
                structureIdentifierId: {
                    type: Sequelize.UUID,
                    references: {
                        model: StructureIdentifierTableName,
                        key: "id"
                    }
                },
                brainStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
                        key: "id"
                    }
                },
                tracingId: {
                    type: Sequelize.UUID,
                    references: {
                        model: "Tracing",
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(TracingNodeTableName, ["tracingId"]);
        await queryInterface.addIndex(TracingNodeTableName, ["brainStructureId"]);
        await queryInterface.addIndex(TracingNodeTableName, ["structureIdentifierId"]);

        await queryInterface.createTable(
            SearchContentTable,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                somaX: Sequelize.DOUBLE,
                somaY: Sequelize.DOUBLE,
                somaZ: Sequelize.DOUBLE,
                nodeCount: Sequelize.INTEGER,
                somaCount: Sequelize.INTEGER,
                pathCount: Sequelize.INTEGER,
                branchCount: Sequelize.INTEGER,
                endCount: Sequelize.INTEGER,
                neuronIdString: Sequelize.TEXT,
                neuronDOI: Sequelize.TEXT,
                neuronConsensus: Sequelize.INTEGER,
                visibility: Sequelize.INTEGER,
                tracingId: {
                    type: Sequelize.UUID,
                    references: {
                        model: TracingTableName,
                        key: "id"
                    }
                },
                brainAreaId: {
                    type: Sequelize.UUID,
                    references: {
                        model: BrainStructureTableName,
                        key: "id"
                    }
                },
                neuronId: {
                    type: Sequelize.UUID,
                    references: {
                        model: NeuronTableName,
                        key: "id"
                    }
                },
                tracingStructureId: {
                    type: Sequelize.UUID,
                    references: {
                        model: TracingStructureTableName,
                        key: "id"
                    }
                },
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SearchContentTable, ["neuronId"]);
        await queryInterface.addIndex(SearchContentTable, ["tracingId"]);
        await queryInterface.addIndex(SearchContentTable, ["brainAreaId"]);
        await queryInterface.addIndex(SearchContentTable, ["tracingStructureId"]);
        await queryInterface.addIndex(SearchContentTable, ["nodeCount"]);
        await queryInterface.addIndex(SearchContentTable, ["somaCount"]);
        await queryInterface.addIndex(SearchContentTable, ["pathCount"]);
        await queryInterface.addIndex(SearchContentTable, ["branchCount"]);
        await queryInterface.addIndex(SearchContentTable, ["endCount"]);
        await queryInterface.addIndex(SearchContentTable, ["neuronConsensus"]);

        await queryInterface.createTable(
            SynchronizationMarkerTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                markerKind: Sequelize.INTEGER,
                appliedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE
            }
        );

        await queryInterface.addIndex(SynchronizationMarkerTableName, ["markerKind"]);
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.dropTable(SynchronizationMarkerTableName);

        await queryInterface.dropTable(SearchContentTable);

        await queryInterface.dropTable(TracingNodeTableName);
        await queryInterface.dropTable(TracingTableName);
        await queryInterface.dropTable(StructureIdentifierTableName);
        await queryInterface.dropTable(TracingStructureTableName);

        await queryInterface.dropTable(NeuronTableName);
        await queryInterface.dropTable(SampleTableName);
        await queryInterface.dropTable(GenotypeTableName);
        await queryInterface.dropTable(BrainStructureTableName);
    }
};
