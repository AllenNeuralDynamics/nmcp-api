/// <reference types="jest" />

import { AtlasReconstruction, PortalJsonReconstruction } from "../src/models/atlasReconstruction";
import { Tracing } from "../src/models/tracing";
import { TracingNode } from "../src/models/tracingNode";
import { AtlasStructure } from "../src/models/atlasStructure";
import { ReconstructionTestFixtures } from "./fixtures/reconstructionFixtures";

// Mock database models
jest.mock("../src/models/tracing");
jest.mock("../src/models/tracingNode");
jest.mock("../src/models/atlasStructure");

describe("Reconstruction.getAsDataChunked", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("successful chunked data retrieval", () => {
        it("should return complete data when no chunking options specified", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findOne as jest.Mock).mockResolvedValue(
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 1 })
            );
            (TracingNode.count as jest.Mock).mockResolvedValue(100);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 1 }),
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 2 })
            ]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id");

            expect(result).toBeTruthy();
            expect(result!.comment).toBe("");
            expect(result!.header).toBeDefined();
            expect(result!.axon).toBeDefined();
            expect(result!.dendrite).toBeDefined();
            expect(result!.allenInformation).toBeDefined();
            expect(result!.axonChunkInfo).toBeDefined();
            expect(result!.dendriteChunkInfo).toBeDefined();
        });

        it("should return only requested parts when parts option specified", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            
            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            expect(result).toBeTruthy();
            expect(result!.comment).toBe("");
            expect(result!.header).toBeDefined();
            expect(result!.axon).toBeUndefined();
            expect(result!.dendrite).toBeUndefined();
            expect(result!.allenInformation).toBeUndefined();
        });

        it("should handle axon pagination correctly", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(1000);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 11 }),
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 12 })
            ]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["axon"],
                axonOffset: 10,
                axonLimit: 50
            });

            expect(result!.axon).toHaveLength(2);
            expect(result!.axonChunkInfo).toEqual({
                totalCount: 1000,
                offset: 10,
                limit: 50,
                hasMore: true
            });
            
            // Verify correct query parameters
            expect(TracingNode.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    offset: 10,
                    limit: 50
                })
            );
        });

        it("should handle dendrite pagination correctly", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(500);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 21 })
            ]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["dendrite"],
                dendriteOffset: 20,
                dendriteLimit: 25
            });

            expect(result!.dendrite).toHaveLength(1);
            expect(result!.dendriteChunkInfo).toEqual({
                totalCount: 500,
                offset: 20,
                limit: 25,
                hasMore: true
            });
        });

        it("should correctly identify when there is no more data", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(100);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["axon"],
                axonOffset: 90,
                axonLimit: 20
            });

            expect(result!.axonChunkInfo!.hasMore).toBe(false);
        });

        it("should build header data correctly when requested", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };
            const somaNode = ReconstructionTestFixtures.createMockTracingNode({ 
                sampleNumber: 1, 
                x: 100, 
                y: 200, 
                z: 300 
            });

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findOne as jest.Mock).mockResolvedValue(somaNode);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            expect(result!.header).toEqual({
                id: mockReconstruction.Neuron.id,
                idString: mockReconstruction.Neuron.idString,
                DOI: mockReconstruction.Neuron.doi,
                sample: {
                    date: mockReconstruction.Neuron.Sample.sampleDate,
                    subject: mockReconstruction.Neuron.Sample.animalId,
                    genotype: mockReconstruction.Neuron.Sample.MouseStrain.name,
                    collection: {
                        id: mockReconstruction.Neuron.Sample.Collection.id,
                        name: mockReconstruction.Neuron.Sample.Collection.name,
                        description: mockReconstruction.Neuron.Sample.Collection.description,
                        reference: mockReconstruction.Neuron.Sample.Collection.reference
                    }
                },
                label: [{
                    virus: "AAV2/1.FLEX-eGFP",
                    fluorophore: "eGFP"
                }],
                annotationSpace: {
                    version: 3,
                    description: "Annotation Space: CCFv3.0 Axes> X: Anterior-Posterior; Y: Inferior-Superior; Z:Left-Right"
                },
                annotator: expect.objectContaining({ id: "annotator-user-id" }),
                proofreader: expect.objectContaining({ id: "proofreader-user-id" }),
                peerReviewer: null,
                soma: {
                    x: 300, // z becomes x
                    y: 200, // y stays y
                    z: 100, // x becomes z
                    allenId: null
                },
                axonId: "axon-id",
                dendriteId: "dendrite-id"
            });
        });

        it("should load Allen information when requested", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };
            const mockBrainArea = ReconstructionTestFixtures.createMockBrainArea("area-1");
            const mockNodeWithBrainArea = { BrainArea: mockBrainArea };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([mockNodeWithBrainArea]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["allenInformation"]
            });

            expect(result!.allenInformation).toHaveLength(1);
            expect(result!.allenInformation![0]).toEqual({
                allenId: mockBrainArea.structureId,
                name: mockBrainArea.name,
                safeName: mockBrainArea.safeName,
                acronym: mockBrainArea.acronym,
                graphOrder: mockBrainArea.graphOrder,
                structurePath: mockBrainArea.structureIdPath,
                colorHex: mockBrainArea.geometryColor
            });
        });
    });

    describe("null return cases", () => {
        it("should return null when reconstruction not found", async () => {
            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(null);

            const result = await AtlasReconstruction.getAsDataChunked("nonexistent-id");

            expect(result).toBeNull();
        });

        it("should return null when reconstruction has wrong number of tracings", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            
            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([{ id: "single-tracing" }]); // Only 1 tracing

            const result = await AtlasReconstruction.getAsDataChunked("test-id");

            expect(result).toBeNull();
        });
    });

    describe("edge cases", () => {
        it("should handle empty parts array", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            
            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: []
            });

            expect(result).toBeTruthy();
            expect(result!.comment).toBe("");
            expect(result!.header).toBeUndefined();
            expect(result!.axon).toBeUndefined();
            expect(result!.dendrite).toBeUndefined();
            expect(result!.allenInformation).toBeUndefined();
        });

        it("should handle zero offset and treat zero limit as null", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(100);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["axon"],
                axonOffset: 0,
                axonLimit: 0
            });

            expect(result!.axonChunkInfo).toEqual({
                totalCount: 100,
                offset: 0,
                limit: 100, // 0 is treated as null, so uses totalCount
                hasMore: false
            });
        });

        it("should handle large offset beyond total count", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(50);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["axon"],
                axonOffset: 100,
                axonLimit: 10
            });

            expect(result!.axon).toHaveLength(0);
            expect(result!.axonChunkInfo!.hasMore).toBe(false);
        });

        it("should handle missing soma node gracefully", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findOne as jest.Mock).mockResolvedValue(null);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            expect(result!.header!.soma).toBeNull();
        });

        it("should handle reconstruction with missing optional neuron data", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createReconstructionWithMissingData();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findOne as jest.Mock).mockResolvedValue(
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 1 })
            );

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            expect(result!.header!.sample.genotype).toBeNull();
            expect(result!.header!.sample.collection.id).toBeNull();
            expect(result!.header!.label).toBeNull();
        });
    });

    describe("performance considerations", () => {
        it("should only load required data based on parts parameter", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findOne as jest.Mock).mockResolvedValue(
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 1 })
            );

            await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            // Should call tracing queries for header (needs tracings metadata for soma and IDs)
            expect(Tracing.findAll).toHaveBeenCalled();
            // Should not call TracingNode.findAll for node data when only header is requested
            expect(TracingNode.findAll).not.toHaveBeenCalled();
        });

        it("should use database-level pagination instead of application-level", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(1000);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([]);

            await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["axon"],
                axonOffset: 100,
                axonLimit: 50
            });

            expect(TracingNode.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    offset: 100,
                    limit: 50
                })
            );
        });

        it("should handle null limit correctly by treating as unlimited", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.count as jest.Mock).mockResolvedValue(1000);
            (TracingNode.findAll as jest.Mock).mockResolvedValue([]);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["axon"],
                axonOffset: 0,
                axonLimit: null as any
            });

            expect(result!.axonChunkInfo).toEqual({
                totalCount: 1000,
                offset: 0,
                limit: 1000,
                hasMore: false
            });

            expect(TracingNode.findAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    offset: 0,
                    limit: null
                })
            );
        });
    });

    describe("data integrity", () => {
        it("should maintain correct coordinate system for soma", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-id" };
            const somaNode = ReconstructionTestFixtures.createMockTracingNode({ 
                sampleNumber: 1, 
                x: 300,
                y: 200, 
                z: 100
            });

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([axonTracing, dendriteTracing]);
            (TracingNode.findOne as jest.Mock).mockResolvedValue(somaNode);

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            // Verify coordinate transformation: soma coordinates are swapped
            expect(result!.header!.soma).toEqual({
                x: 100, // z becomes x
                y: 200, // y stays y
                z: 300, // x becomes z
                allenId: null
            });
        });

        it("should correctly identify axon and dendrite tracings by structure ID", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = { id: "axon-id", tracingStructureId: "68e76074-1777-42b6-bbf9-93a6a5f02fa4" };
            const dendriteTracing = { id: "dendrite-id", tracingStructureId: "other-structure-id" };

            jest.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);
            (Tracing.findAll as jest.Mock).mockResolvedValue([dendriteTracing, axonTracing]); // Order doesn't matter
            (TracingNode.findOne as jest.Mock).mockResolvedValue(
                ReconstructionTestFixtures.createMockTracingNode({ sampleNumber: 1 })
            );

            const result = await AtlasReconstruction.getAsDataChunked("test-id", {
                parts: ["header"]
            });

            expect(result!.header!.axonId).toBe("axon-id");
            expect(result!.header!.dendriteId).toBe("dendrite-id");
        });
    });
});
