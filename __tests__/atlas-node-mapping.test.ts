import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {mapToAtlasNodeShape} = require("../src/models/atlasNode");

function node(atlasStructure?: number) {
    return {index: 1, structure: 1, x: 10, y: 20, z: 30, radius: 1, parentIndex: -1, atlasStructure};
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("mapToAtlasNodeShape", () => {
    test("resolves the structure through the given atlas", () => {
        const atlas = {getFromStructureId: vi.fn().mockImplementation((structureId: number) => structureId === 2 ? {id: "marmoset-2"} : null)};

        const shape = mapToAtlasNodeShape(node(2), "neuron-structure-1", "reconstruction-1", atlas);

        expect(atlas.getFromStructureId).toHaveBeenCalledWith(2);
        expect(shape.atlasStructureId).toBe("marmoset-2");
        expect(shape.manualAtlasAssigment).toBe(true);
    });

    test("an id the given atlas lacks is left for structure assignment", () => {
        const atlas = {getFromStructureId: vi.fn().mockReturnValue(null)};

        const shape = mapToAtlasNodeShape(node(99), "neuron-structure-1", "reconstruction-1", atlas);

        expect(shape.atlasStructureId).toBeUndefined();
        expect(shape.manualAtlasAssigment).toBe(false);
    });

    test("a node with no structure is left for structure assignment", () => {
        const atlas = {getFromStructureId: vi.fn().mockReturnValue(null)};

        const shape = mapToAtlasNodeShape(node(), "neuron-structure-1", "reconstruction-1", atlas);

        expect(shape.atlasStructureId).toBeUndefined();
        expect(shape.manualAtlasAssigment).toBe(false);
    });
});
