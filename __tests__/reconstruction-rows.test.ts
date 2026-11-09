import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const fs = require("fs");

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {NeuronStructure} = require("../src/models/neuronStructure");
const {buildSimpleReconstruction, toNodeData, toReconstructionRows} = require("../src/io/simpleReconstruction");
const {swcParse} = require("../src/io/swcParser");

function row(index: number, structure: number, parentIndex: number) {
    return {index, parentIndex, structure, x: index, y: index * 2, z: index * 3, radius: 1, atlasStructure: null};
}

// Soma 1; axon 2 (a fork) with ends 3 and 4; apical dendrite 5 (a fork) with end 6 and path 7, which ends at 8.
const branchingRows = [
    row(1, 1, -1),
    row(2, 2, 1),
    row(3, 2, 2),
    row(4, 2, 2),
    row(5, 4, 1),
    row(6, 4, 5),
    row(7, 4, 5),
    row(8, 4, 7)
];

function branching() {
    return buildSimpleReconstruction("branching.swc", branchingRows.map(value => ({...value})), "# branching\n");
}

function sample() {
    return swcParse("swc-sample.swc", fs.createReadStream("./__tests__/fixtures/swc-sample.swc"));
}

function nodesByIndex(structure: any) {
    return new Map(structure.getNonSomaNodes().map((node: any) => [node.index, node]));
}

function expectSameStructure(rebuilt: any, original: any) {
    expect(rebuilt.soma?.index).toBe(original.soma?.index);

    const rebuiltNodes = nodesByIndex(rebuilt);
    const originalNodes = nodesByIndex(original);

    expect([...rebuiltNodes.keys()].sort()).toEqual([...originalNodes.keys()].sort());

    for (const [index, node] of originalNodes as Map<number, any>) {
        const copy: any = rebuiltNodes.get(index);

        expect(copy.structure).toBe(node.structure);
        expect(copy.lengthToParent).toBeCloseTo(node.lengthToParent, 9);
    }

    expect(rebuilt.nodeCounts).toEqual(original.nodeCounts);
}

beforeEach(() => {
    vi.spyOn(NeuronStructure, "AxonStructureId", "get").mockReturnValue("ns-axon");
    vi.spyOn(NeuronStructure, "DendriteStructureId", "get").mockReturnValue("ns-dendrite");
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("toReconstructionRows", () => {
    test.each([
        ["a branching reconstruction", async () => branching()],
        ["the SWC sample", sample]
    ])("emits each node of %s once, as its compartment", async (_label: string, build: () => Promise<any>) => {
        const data = await build();

        const before = [...data.axon.getNonSomaNodes(), ...data.dendrite.getNonSomaNodes()].map((node: any) => node.structure);

        const rows = toReconstructionRows(data);

        const indexes = rows.map((value: any) => value.index);

        expect(new Set(indexes).size).toBe(indexes.length);
        expect(rows[0].index).toBe((data.axon.soma ?? data.dendrite.soma).index);

        for (const value of rows) {
            expect([1, 2, 3]).toContain(value.structure);
        }

        const axonIndexes = new Set(data.axon.getNonSomaNodes().filter((node: any) => node.structure != 1).map((node: any) => node.index));
        const dendriteIndexes = new Set(data.dendrite.getNonSomaNodes().filter((node: any) => node.structure != 1).map((node: any) => node.index));

        for (const value of rows.slice(1)) {
            if (axonIndexes.has(value.index)) {
                expect(value.structure).toBe(2);
            } else if (dendriteIndexes.has(value.index)) {
                expect(value.structure).toBe(3);
            }
        }

        const after = [...data.axon.getNonSomaNodes(), ...data.dendrite.getNonSomaNodes()].map((node: any) => node.structure);

        expect(after).toEqual(before);
        expect(rows.every((value: any) => !("lengthToParent" in value))).toBe(true);
    });

    test("labels the branching reconstruction's compartments exactly", () => {
        const rows = toReconstructionRows(branching());

        expect(rows.map((value: any) => [value.index, value.structure])).toEqual([
            [1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [7, 3], [8, 3]
        ]);
    });

    test.each([
        ["a branching reconstruction", async () => branching()],
        ["the SWC sample", sample]
    ])("rebuilds %s exactly", async (_label: string, build: () => Promise<any>) => {
        const data = await build();

        const rebuilt = buildSimpleReconstruction(data.source, toReconstructionRows(data), data.comments);

        expectSameStructure(rebuilt.axon, data.axon);
        expectSameStructure(rebuilt.dendrite, data.dendrite);
        expect(rebuilt.comments).toBe(data.comments);
    });

    test("keeps a non-root node still labeled soma once, and rebuilds it into both structures", () => {
        const data = buildSimpleReconstruction("soma.swc", [row(1, 1, -1), row(2, 1, 1), row(3, 2, 2), row(4, 3, 2)]);

        const rows = toReconstructionRows(data);

        expect(rows.filter((value: any) => value.index == 2)).toEqual([expect.objectContaining({index: 2, structure: 1})]);

        const rebuilt = buildSimpleReconstruction(data.source, rows, data.comments);

        expect(nodesByIndex(rebuilt.axon).has(2)).toBe(true);
        expect(nodesByIndex(rebuilt.dendrite).has(2)).toBe(true);
        expectSameStructure(rebuilt.axon, data.axon);
        expectSameStructure(rebuilt.dendrite, data.dendrite);
    });
});

describe("toNodeData", () => {
    test("keeps exactly the seven portal fields", () => {
        const nodes = toNodeData([{...row(1, 1, -1), atlasStructure: 42}]);

        expect(nodes).toEqual([{index: 1, structure: 1, x: 1, y: 2, z: 3, radius: 1, parentIndex: -1}]);
    });
});
