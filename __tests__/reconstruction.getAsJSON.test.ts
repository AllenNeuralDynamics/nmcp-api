/// <reference types="jest" />

import { Reconstruction } from "../src/models/reconstruction";
import { ReconstructionTestFixtures } from "./fixtures/reconstructionFixtures";

describe("Reconstruction.getAsJSON", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("successful transformations", () => {
        it("should return properly formatted JSON for valid reconstruction", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result).toBeTruthy();
            expect(result!.comment).toBe("");
            expect(result!.neurons).toHaveLength(1);
            
            const neuron = result!.neurons[0];
            expect(neuron.id).toBe(mockReconstruction.Neuron.id);
            expect(neuron.idString).toBe(mockReconstruction.Neuron.idString);
            expect(neuron.DOI).toBe(mockReconstruction.Neuron.doi);
            expect(neuron.axon).toBeInstanceOf(Array);
            expect(neuron.dendrite).toBeInstanceOf(Array);
            expect(neuron.allenInformation).toBeInstanceOf(Array);
            
            // Verify database query was called with correct parameters
            expect(Reconstruction.findByPk).toHaveBeenCalledWith("test-id", {
                include: expect.arrayContaining([
                    expect.objectContaining({
                        model: expect.anything(),
                        as: "Neuron"
                    }),
                    expect.objectContaining({
                        model: expect.anything(),
                        as: "Tracings"
                    })
                ])
            });
        });

        it("should handle reconstruction with missing optional data", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createReconstructionWithMissingData();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result).toBeTruthy();
            const neuron = result!.neurons[0];
            expect(neuron.label).toBeNull(); // No injections
            expect(neuron.sample.genotype).toBeNull(); // No mouse strain
            expect(neuron.sample.collection.id).toBeNull(); // No collection
            expect(neuron.peerReviewer).toBeNull(); // No peer reviewer
        });

        it("should handle large reconstructions", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createLargeReconstruction();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result).toBeTruthy();
            const neuron = result!.neurons[0];
            expect(neuron.axon.length).toBeGreaterThan(100);
            expect(neuron.dendrite.length).toBeGreaterThan(100);
        });
    });

    describe("null return cases", () => {
        it("should return null when reconstruction not found", async () => {
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(null);

            const result = await Reconstruction.getAsJSON("nonexistent-id");

            expect(result).toBeNull();
        });

        it("should return null when reconstruction has wrong number of tracings", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            // Remove one tracing to make it invalid
            mockReconstruction.Tracings = [mockReconstruction.Tracings[0]];
            
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result).toBeNull();
        });

        it("should return null when reconstruction has no soma", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createReconstructionWithoutSoma();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result).toBeNull();
        });

        it("should return null when reconstruction has empty tracings array", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            mockReconstruction.Tracings = [];
            
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result).toBeNull();
        });
    });

    describe("edge cases", () => {
        it("should handle reconstruction with only axon tracing", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createReconstructionWithOnlyAxon();
            // Add a second tracing to meet the count requirement
            const secondTracing = ReconstructionTestFixtures.createMockTracing({
                id: "empty-dendrite",
                structureId: ReconstructionTestFixtures.DENDRITE_STRUCTURE_ID,
                nodeCount: 1,
                includesSoma: false
            });
            mockReconstruction.Tracings.push(secondTracing);
            
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            // Should still return null because no soma is found
            expect(result).toBeNull();
        });

        it("should handle database query errors gracefully", async () => {
            jest.spyOn(Reconstruction, "findByPk").mockRejectedValue(new Error("Database connection failed"));

            await expect(Reconstruction.getAsJSON("test-id")).rejects.toThrow("Database connection failed");
        });

        it("should handle async method errors in transformation", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            mockReconstruction.getAnnotator.mockRejectedValue(new Error("Annotator fetch failed"));
            
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            await expect(Reconstruction.getAsJSON("test-id")).rejects.toThrow("Annotator fetch failed");
        });
    });

    describe("data integrity", () => {
        it("should preserve coordinate transformation (x/z swap)", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const dendriteTracing = mockReconstruction.Tracings.find(t => 
                t.tracingStructureId === ReconstructionTestFixtures.DENDRITE_STRUCTURE_ID
            );
            
            // Set known coordinates on soma node
            const somaNode = dendriteTracing.Nodes.find((n: any) => n.sampleNumber === 1);
            somaNode.x = 300;
            somaNode.y = 200;
            somaNode.z = 100;
            
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result!.neurons[0].soma.x).toBe(300);
            expect(result!.neurons[0].soma.y).toBe(200);
            expect(result!.neurons[0].soma.z).toBe(100);
        });

        it("should maintain correct tracing IDs", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            const axonTracing = mockReconstruction.Tracings.find(t => 
                t.tracingStructureId === ReconstructionTestFixtures.AXON_STRUCTURE_ID
            );
            const dendriteTracing = mockReconstruction.Tracings.find(t => 
                t.tracingStructureId === ReconstructionTestFixtures.DENDRITE_STRUCTURE_ID
            );
            
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            expect(result!.neurons[0].axonId).toBe(axonTracing.id);
            expect(result!.neurons[0].dendriteId).toBe(dendriteTracing.id);
        });

        it("should include all node properties", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            const result = await Reconstruction.getAsJSON("test-id");

            const firstAxonNode = result!.neurons[0].axon[0];
            expect(firstAxonNode).toHaveProperty("sampleNumber");
            expect(firstAxonNode).toHaveProperty("structureIdentifier");
            expect(firstAxonNode).toHaveProperty("x");
            expect(firstAxonNode).toHaveProperty("y");
            expect(firstAxonNode).toHaveProperty("z");
            expect(firstAxonNode).toHaveProperty("radius");
            expect(firstAxonNode).toHaveProperty("parentNumber");
            expect(firstAxonNode).toHaveProperty("allenId");
        });
    });

    describe("performance considerations", () => {
        it("should only call database once per invocation", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            await Reconstruction.getAsJSON("test-id");

            expect(Reconstruction.findByPk).toHaveBeenCalledTimes(1);
        });

        it("should call association methods once per reconstruction", async () => {
            const mockReconstruction = ReconstructionTestFixtures.createMockReconstruction();
            jest.spyOn(Reconstruction, "findByPk").mockResolvedValue(mockReconstruction as any);

            await Reconstruction.getAsJSON("test-id");

            expect(mockReconstruction.getAnnotator).toHaveBeenCalledTimes(1);
            expect(mockReconstruction.getProofreader).toHaveBeenCalledTimes(1);
            expect(mockReconstruction.getPeerReviewer).toHaveBeenCalledTimes(1);
        });
    });
});
