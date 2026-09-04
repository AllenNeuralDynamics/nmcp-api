import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the operation calls into, so the spies would not apply.
const {SearchIndexOperation} = require("../src/transform/searchIndexOperation");
const {SearchIndex} = require("../src/models/searchIndex");
const {AtlasNode} = require("../src/models/atlasNode");

const transaction = {sentinel: "t"} as any;

// atlasStructureId has to be a non-empty string or _populateCompartmentMap skips the node and nothing is inserted.
const somaNode = {
    id: "soma-1",
    atlasStructureId: "structure-1",
    neuronStructureId: "ns-soma",
    nodeStructureId: "node-soma",
    lengthToParent: 0
};

const neuron = {
    id: "neuron-1",
    label: "N1",
    atlasStructureId: null,
    canonicalDoi: "",
    atlasSoma: {x: 1, y: 2, z: 3},
    Specimen: {
        label: "S1",
        atlasId: "atlas-1",
        collectionId: "collection-1",
        getAtlas: () => ({atlasKindId: "kind-1"})
    }
};

function stub(id: string | null = "atlas-1") {
    const getNeuron = vi.fn().mockResolvedValue(neuron);

    const atlasReconstruction = {
        id: id,
        doi: "10.0/abc",
        getReconstruction: vi.fn().mockResolvedValue({getNeuron: getNeuron}),
        getSoma: vi.fn().mockResolvedValue(somaNode)
    };

    return {
        operation: new SearchIndexOperation(atlasReconstruction),
        atlasReconstruction: atlasReconstruction,
        getNeuron: getNeuron,
        // One row rather than zero so the chunk loop actually runs and findAll's transaction can be asserted.
        count: vi.spyOn(AtlasNode, "count").mockResolvedValue(1),
        findAll: vi.spyOn(AtlasNode, "findAll").mockResolvedValue([somaNode] as any),
        destroy: vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0),
        bulkCreate: vi.spyOn(SearchIndex, "bulkCreate").mockResolvedValue([] as any)
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("SearchIndexOperation.process", () => {
    test("deletes the existing index rows exactly once", async () => {
        const stubs = stub();

        await stubs.operation.process(transaction);

        expect(stubs.destroy).toHaveBeenCalledTimes(1);
    });

    test("deletes through the enclosing transaction", async () => {
        const stubs = stub();

        await stubs.operation.process(transaction);

        expect(stubs.destroy).toHaveBeenCalledWith({where: {reconstructionId: "atlas-1"}, transaction: transaction});
    });

    test("deletes before any insert", async () => {
        const stubs = stub();

        await stubs.operation.process(transaction);

        expect(stubs.bulkCreate.mock.invocationCallOrder.length).toBeGreaterThan(0);

        for (const order of stubs.bulkCreate.mock.invocationCallOrder) {
            expect(stubs.destroy.mock.invocationCallOrder[0]).toBeLessThan(order);
        }
    });

    test("inserts through the enclosing transaction", async () => {
        const stubs = stub();

        await stubs.operation.process(transaction);

        for (const call of stubs.bulkCreate.mock.calls) {
            expect(call[1]).toEqual({transaction: transaction});
        }
    });

    test("every read carries the enclosing transaction", async () => {
        const stubs = stub();

        await stubs.operation.process(transaction);

        expect(stubs.atlasReconstruction.getReconstruction).toHaveBeenCalledWith({transaction: transaction});
        expect(stubs.atlasReconstruction.getSoma).toHaveBeenCalledWith({transaction: transaction});
        expect(stubs.getNeuron).toHaveBeenCalledWith(expect.objectContaining({transaction: transaction}));

        for (const call of stubs.count.mock.calls) {
            expect(call[0]).toEqual(expect.objectContaining({transaction: transaction}));
        }

        for (const call of stubs.findAll.mock.calls) {
            expect(call[0]).toEqual(expect.objectContaining({transaction: transaction}));
        }
    });

    test("a reconstruction with no id does nothing at all", async () => {
        const stubs = stub(null);

        await stubs.operation.process(transaction);

        expect(stubs.atlasReconstruction.getReconstruction).not.toHaveBeenCalled();
        expect(stubs.destroy).not.toHaveBeenCalled();
        expect(stubs.bulkCreate).not.toHaveBeenCalled();
    });
});
