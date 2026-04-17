import {expect, test} from "vitest";

import {computeMetrics, StructureIds} from "../src/data-access/reconstructionMetricsService";

const AXON_STRUCTURE_ID = "ns-axon";
const DENDRITE_STRUCTURE_ID = "ns-dendrite";

const structureIds: StructureIds = {
    axonStructureId: AXON_STRUCTURE_ID,
    dendriteStructureId: DENDRITE_STRUCTURE_ID,
};

function makeEntry(overrides: Record<string, any>) {
    return {
        nodeCount: 0,
        pathCount: 0,
        branchCount: 0,
        endCount: 0,
        totalLengthMicrometer: 0,
        axonLengthMicrometer: 0,
        dendriteLengthMicrometer: 0,
        neuronStructureId: AXON_STRUCTURE_ID,
        atlasStructureId: "atlas-1",
        ...overrides,
    };
}

test("returns null for empty entries", () => {
    const result = computeMetrics("recon-1", [], structureIds);

    expect(result).toBeNull();
});

test("computes metrics for a single structure", () => {
    const entries = [
        makeEntry({
            nodeCount: 100,
            pathCount: 10,
            branchCount: 5,
            endCount: 6,
            totalLengthMicrometer: 500.0,
            axonLengthMicrometer: 500.0,
            dendriteLengthMicrometer: 0,
        }),
    ];

    const result = computeMetrics("recon-1", entries, structureIds);

    expect(result).not.toBeNull();
    expect(result.reconstructionId).toBe("recon-1");

    expect(result.nodeCounts.totalNodeCount).toBe(100);
    expect(result.nodeCounts.totalPathCount).toBe(10);
    expect(result.nodeCounts.totalBranchCount).toBe(5);
    expect(result.nodeCounts.totalEndCount).toBe(6);

    expect(result.nodeCounts.byStructure).toHaveLength(1);
    expect(result.nodeCounts.byStructure[0].nodePercentage).toBe(100);
    expect(result.nodeCounts.byStructure[0].atlasStructureId).toBe("atlas-1");

    expect(result.lengths.totalLengthMicrometer).toBe(500);
    expect(result.lengths.totalAxonLengthMicrometer).toBe(500);
    expect(result.lengths.totalDendriteLengthMicrometer).toBe(0);

    expect(result.lengths.byStructure).toHaveLength(1);
    expect(result.lengths.byStructure[0].totalLengthPercentage).toBe(100);

    expect(result.nodeCounts.dominantNodeStructures).toHaveLength(1);
    expect(result.nodeCounts.dominantNodeStructures[0].atlasStructureId).toBe("atlas-1");

    expect(result.nodeCounts.dominantAxonNodeStructures).toHaveLength(1);
    expect(result.nodeCounts.dominantDendriteNodeStructures).toHaveLength(0);

    expect(result.detailedEntries).toHaveLength(1);
});

test("aggregates multiple structures correctly", () => {
    const entries = [
        makeEntry({
            atlasStructureId: "atlas-1",
            neuronStructureId: AXON_STRUCTURE_ID,
            nodeCount: 60,
            pathCount: 6,
            branchCount: 3,
            endCount: 4,
            totalLengthMicrometer: 300,
            axonLengthMicrometer: 300,
            dendriteLengthMicrometer: 0,
        }),
        makeEntry({
            atlasStructureId: "atlas-1",
            neuronStructureId: DENDRITE_STRUCTURE_ID,
            nodeCount: 40,
            pathCount: 4,
            branchCount: 2,
            endCount: 3,
            totalLengthMicrometer: 200,
            axonLengthMicrometer: 0,
            dendriteLengthMicrometer: 200,
        }),
        makeEntry({
            atlasStructureId: "atlas-2",
            neuronStructureId: AXON_STRUCTURE_ID,
            nodeCount: 100,
            pathCount: 10,
            branchCount: 5,
            endCount: 6,
            totalLengthMicrometer: 600,
            axonLengthMicrometer: 600,
            dendriteLengthMicrometer: 0,
        }),
    ];

    const result = computeMetrics("recon-2", entries, structureIds);

    expect(result.nodeCounts.totalNodeCount).toBe(200);
    expect(result.nodeCounts.totalPathCount).toBe(20);

    expect(result.nodeCounts.byStructure).toHaveLength(2);
    expect(result.nodeCounts.byStructure[0].atlasStructureId).toBe("atlas-1");
    expect(result.nodeCounts.byStructure[0].nodeCount).toBe(100);
    expect(result.nodeCounts.byStructure[0].nodePercentage).toBe(50);

    expect(result.nodeCounts.byStructure[1].atlasStructureId).toBe("atlas-2");
    expect(result.nodeCounts.byStructure[1].nodeCount).toBe(100);
    expect(result.nodeCounts.byStructure[1].nodePercentage).toBe(50);

    expect(result.lengths.totalLengthMicrometer).toBe(1100);
    expect(result.lengths.totalAxonLengthMicrometer).toBe(900);
    expect(result.lengths.totalDendriteLengthMicrometer).toBe(200);

    expect(result.lengths.byStructure[0].atlasStructureId).toBe("atlas-2");
    expect(result.lengths.byStructure[0].totalLengthMicrometer).toBe(600);

    expect(result.detailedEntries).toHaveLength(3);
    expect(result.detailedEntries[0].nodeCount).toBeGreaterThanOrEqual(result.detailedEntries[1].nodeCount);
});

test("identifies tied dominant structures", () => {
    const entries = [
        makeEntry({
            atlasStructureId: "atlas-1",
            nodeCount: 50,
            totalLengthMicrometer: 250,
            axonLengthMicrometer: 250,
        }),
        makeEntry({
            atlasStructureId: "atlas-2",
            nodeCount: 50,
            totalLengthMicrometer: 250,
            axonLengthMicrometer: 250,
        }),
    ];

    const result = computeMetrics("recon-3", entries, structureIds);

    expect(result.nodeCounts.dominantNodeStructures).toHaveLength(2);
    expect(result.lengths.dominantLengthStructures).toHaveLength(2);
    expect(result.nodeCounts.dominantAxonNodeStructures).toHaveLength(2);
});

test("axon-only reconstruction has empty dendrite dominants", () => {
    const entries = [
        makeEntry({
            neuronStructureId: AXON_STRUCTURE_ID,
            nodeCount: 80,
            totalLengthMicrometer: 400,
            axonLengthMicrometer: 400,
            dendriteLengthMicrometer: 0,
        }),
    ];

    const result = computeMetrics("recon-4", entries, structureIds);

    expect(result.nodeCounts.dominantAxonNodeStructures).toHaveLength(1);
    expect(result.nodeCounts.dominantDendriteNodeStructures).toHaveLength(0);
    expect(result.lengths.dominantAxonLengthStructures).toHaveLength(1);
    expect(result.lengths.dominantDendriteLengthStructures).toHaveLength(0);
});

test("sorts node count entries by nodeCount descending and length entries by length descending", () => {
    const entries = [
        makeEntry({
            atlasStructureId: "atlas-1",
            nodeCount: 10,
            totalLengthMicrometer: 500,
        }),
        makeEntry({
            atlasStructureId: "atlas-2",
            nodeCount: 90,
            totalLengthMicrometer: 100,
        }),
    ];

    const result = computeMetrics("recon-5", entries, structureIds);

    expect(result.nodeCounts.byStructure[0].atlasStructureId).toBe("atlas-2");
    expect(result.nodeCounts.byStructure[1].atlasStructureId).toBe("atlas-1");

    expect(result.lengths.byStructure[0].atlasStructureId).toBe("atlas-1");
    expect(result.lengths.byStructure[1].atlasStructureId).toBe("atlas-2");
});

test("percentages handle zero totals without NaN", () => {
    const entries = [
        makeEntry({
            nodeCount: 0,
            totalLengthMicrometer: 0,
            axonLengthMicrometer: 0,
            dendriteLengthMicrometer: 0,
        }),
    ];

    const result = computeMetrics("recon-6", entries, structureIds);

    expect(result.nodeCounts.byStructure[0].nodePercentage).toBe(0);
    expect(result.lengths.byStructure[0].totalLengthPercentage).toBe(0);
    expect(result.lengths.byStructure[0].axonLengthPercentage).toBe(0);
    expect(result.lengths.byStructure[0].dendriteLengthPercentage).toBe(0);

    expect(result.detailedEntries[0].nodePercentage).toBe(0);
    expect(result.detailedEntries[0].totalLengthPercentage).toBe(0);
});
