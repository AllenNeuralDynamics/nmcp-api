/// <reference types="jest" />

import {
    mapNodes,
    extractTracingData,
    extractAllenInformation,
    buildSampleData,
    buildLabelData,
    transformReconstructionToJSON
} from "../src/models/reconstruction";
import { ReconstructionTestFixtures } from "./fixtures/reconstructionFixtures";

describe("Reconstruction Pure Functions", () => {
    describe("mapNodes", () => {
        it("should map TracingNode data to ReconstructionDataNode format", () => {
            const mockNodes = [
                ReconstructionTestFixtures.createMockTracingNode({
                    sampleNumber: 1,
                    x: 100,
                    y: 200,
                    z: 300,
                    radius: 1.5,
                    parentNumber: 0,
                    structureId: 2
                }),
                ReconstructionTestFixtures.createMockTracingNode({
                    sampleNumber: 2,
                    x: 110,
                    y: 210,
                    z: 320,
                    radius: 2.0,
                    parentNumber: 1,
                    structureId: 3
                })
            ];

            const result = mapNodes(mockNodes);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                sampleNumber: 1,
                structureIdentifier: 2,
                x: 100, // createMockTracingNode swaps, then mapNodes swaps back
                y: 200,
                z: 300,
                radius: 1.5,
                parentNumber: 0,
                allenId: null
            });
            expect(result[1]).toEqual({
                sampleNumber: 2,
                structureIdentifier: 3,
                x: 110,
                y: 210,
                z: 320,
                radius: 2.0,
                parentNumber: 1,
                allenId: null
            });
        });

        it("should handle nodes without brain area", () => {
            const mockNode = ReconstructionTestFixtures.createMockTracingNode({
                brainArea: null
            });

            const result = mapNodes([mockNode]);

            expect(result[0].allenId).toBeNull();
        });
    });

    describe("extractTracingData", () => {
        it("should correctly separate axon and dendrite tracings", () => {
            const mockTracings = [
                ReconstructionTestFixtures.createMockTracing({
                    id: "dendrite-1",
                    structureId: ReconstructionTestFixtures.DENDRITE_STRUCTURE_ID,
                    nodeCount: 5,
                    includesSoma: true
                }),
                ReconstructionTestFixtures.createMockTracing({
                    id: "axon-1",
                    structureId: ReconstructionTestFixtures.AXON_STRUCTURE_ID,
                    nodeCount: 8,
                    includesSoma: false
                })
            ];

            const result = extractTracingData(mockTracings);

            expect(result.dendriteId).toBe("dendrite-1");
            expect(result.axonId).toBe("axon-1");
            expect(result.dendrite).toHaveLength(5);
            expect(result.axon).toHaveLength(8);
            expect(result.soma).toBeTruthy();
            expect(result.soma!.sampleNumber).toBe(1);
        });

        it("should find soma in axon if not in dendrite", () => {
            const mockTracings = [
                ReconstructionTestFixtures.createMockTracing({
                    id: "dendrite-1",
                    structureId: ReconstructionTestFixtures.DENDRITE_STRUCTURE_ID,
                    nodeCount: 3,
                    includesSoma: false
                }),
                ReconstructionTestFixtures.createMockTracing({
                    id: "axon-1",
                    structureId: ReconstructionTestFixtures.AXON_STRUCTURE_ID,
                    nodeCount: 5,
                    includesSoma: true
                })
            ];

            const result = extractTracingData(mockTracings);

            expect(result.soma).toBeTruthy();
            expect(result.soma!.sampleNumber).toBe(1);
        });

        it("should return null soma if no soma node found", () => {
            const mockTracings = [
                ReconstructionTestFixtures.createMockTracing({
                    structureId: ReconstructionTestFixtures.DENDRITE_STRUCTURE_ID,
                    includesSoma: false
                }),
                ReconstructionTestFixtures.createMockTracing({
                    structureId: ReconstructionTestFixtures.AXON_STRUCTURE_ID,
                    includesSoma: false
                })
            ];

            const result = extractTracingData(mockTracings);

            expect(result.soma).toBeNull();
        });
    });

    describe("extractAllenInformation", () => {
        it("should extract unique brain areas from all tracings", () => {
            const brainArea1 = ReconstructionTestFixtures.createMockBrainArea("area-1");
            const brainArea2 = ReconstructionTestFixtures.createMockBrainArea("area-2");
            const brainArea3 = ReconstructionTestFixtures.createMockBrainArea("area-3");

            const mockTracings = [
                {
                    Nodes: [
                        ReconstructionTestFixtures.createMockTracingNode({ brainArea: brainArea1 }),
                        ReconstructionTestFixtures.createMockTracingNode({ brainArea: brainArea2 }),
                        ReconstructionTestFixtures.createMockTracingNode({ brainArea: null })
                    ]
                },
                {
                    Nodes: [
                        ReconstructionTestFixtures.createMockTracingNode({ brainArea: brainArea2 }), // Duplicate
                        ReconstructionTestFixtures.createMockTracingNode({ brainArea: brainArea3 })
                    ]
                }
            ];

            const result = extractAllenInformation(mockTracings);

            expect(result).toHaveLength(3); // Should be unique
            expect(result).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        allenId: brainArea1.structureId,
                        name: brainArea1.name,
                        safeName: brainArea1.safeName,
                        acronym: brainArea1.acronym,
                        graphOrder: brainArea1.graphOrder,
                        structurePath: brainArea1.structureIdPath,
                        colorHex: brainArea1.geometryColor
                    }),
                    expect.objectContaining({
                        allenId: brainArea2.structureId,
                        name: brainArea2.name
                    }),
                    expect.objectContaining({
                        allenId: brainArea3.structureId,
                        name: brainArea3.name
                    })
                ])
            );
        });
    });

    describe("buildSampleData", () => {
        it("should build sample data correctly", () => {
            const mockSample = ReconstructionTestFixtures.createMockSample();

            const result = buildSampleData(mockSample);

            expect(result).toEqual({
                date: mockSample.sampleDate,
                subject: mockSample.animalId,
                genotype: mockSample.MouseStrain.name,
                collection: {
                    id: mockSample.Collection.id,
                    name: mockSample.Collection.name,
                    description: mockSample.Collection.description,
                    reference: mockSample.Collection.reference
                }
            });
        });

        it("should handle missing optional data", () => {
            const mockSample = {
                sampleDate: new Date("2023-01-01"),
                animalId: "MOUSE-001",
                MouseStrain: null,
                Collection: null
            };

            const result = buildSampleData(mockSample);

            expect(result).toEqual({
                date: mockSample.sampleDate,
                subject: mockSample.animalId,
                genotype: null,
                collection: {
                    id: null,
                    name: null,
                    description: null,
                    reference: null
                }
            });
        });
    });

    describe("buildLabelData", () => {
        it("should build label data from injections", () => {
            const mockInjections = [
                ReconstructionTestFixtures.createMockInjection(),
                {
                    id: "injection-2",
                    injectionVirus: { name: "AAV-DIO-ChR2" },
                    fluorophore: { name: "mCherry" }
                }
            ];

            const result = buildLabelData(mockInjections);

            expect(result).toHaveLength(2);
            expect(result).toEqual([
                {
                    virus: "AAV2/1.FLEX-eGFP",
                    fluorophore: "eGFP"
                },
                {
                    virus: "AAV-DIO-ChR2",
                    fluorophore: "mCherry"
                }
            ]);
        });

        it("should return null for empty injections", () => {
            expect(buildLabelData([])).toBeNull();
            expect(buildLabelData(null as any)).toBeNull();
            expect(buildLabelData(undefined as any)).toBeNull();
        });
    });

    describe("transformReconstructionToJSON", () => {
        it("should transform complete reconstruction data", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();

            const result = await transformReconstructionToJSON(mockReconstruction);

            expect(result).toEqual({
                comment: "",
                neurons: [
                    expect.objectContaining({
                        id: mockReconstruction.Neuron.id,
                        idString: mockReconstruction.Neuron.idString,
                        DOI: mockReconstruction.Neuron.doi,
                        sample: expect.objectContaining({
                            subject: mockReconstruction.Neuron.Sample.animalId
                        }),
                        label: expect.arrayContaining([
                            expect.objectContaining({
                                virus: expect.any(String),
                                fluorophore: expect.any(String)
                            })
                        ]),
                        annotationSpace: {
                            version: 3,
                            description: expect.stringContaining("CCFv3.0")
                        },
                        annotator: expect.objectContaining({
                            id: expect.stringContaining("annotator")
                        }),
                        proofreader: expect.objectContaining({
                            id: expect.stringContaining("proofreader")
                        }),
                        peerReviewer: null,
                        soma: expect.objectContaining({
                            x: expect.any(Number),
                            y: expect.any(Number),
                            z: expect.any(Number)
                        }),
                        axonId: expect.any(String),
                        axon: expect.arrayContaining([
                            expect.objectContaining({
                                sampleNumber: expect.any(Number),
                                x: expect.any(Number),
                                y: expect.any(Number),
                                z: expect.any(Number)
                            })
                        ]),
                        dendriteId: expect.any(String),
                        dendrite: expect.arrayContaining([
                            expect.objectContaining({
                                sampleNumber: expect.any(Number)
                            })
                        ]),
                        allenInformation: expect.any(Array)
                    })
                ]
            });

            // Verify mocked functions were called
            expect(mockReconstruction.getAnnotator).toHaveBeenCalled();
            expect(mockReconstruction.getProofreader).toHaveBeenCalled();
            expect(mockReconstruction.getPeerReviewer).toHaveBeenCalled();
        });

        it("should handle reconstruction without soma", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createReconstructionWithoutSoma();

            const result = await transformReconstructionToJSON(mockReconstruction);

            expect(result.neurons[0].soma).toEqual({
                x: 0,
                y: 0,
                z: 0,
                allenId: null
            });
        });
    });
});