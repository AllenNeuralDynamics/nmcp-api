import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron} = require("../src/models/neuron");

// Valid version 4 UUIDs whose string order is their numeric order, as Postgres orders them.
function neuronId(index: number): string {
    return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function rowsFor(count: number) {
    return [...Array(count).keys()].map(index => ({id: neuronId(index + 1), atlasSoma: {x: index, y: index, z: index}}));
}

function stubQueries(total: number, rows: any[]) {
    const count = vi.spyOn(Neuron, "count").mockResolvedValue(total);
    const findAll = vi.spyOn(Neuron, "findAll").mockResolvedValue(rows);

    return {count, findAll};
}

function chunkOptions(findAll: any): any {
    return findAll.mock.calls[0][0];
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("getCandidateNeuronLocations chunks", () => {
    test("the first chunk counts the set and reads only ids and somas", async () => {
        const {count, findAll} = stubQueries(42, rowsFor(3));

        const output = await Neuron.getCandidateNeuronLocations({});

        const options = chunkOptions(findAll);

        expect(count).toHaveBeenCalledTimes(1);
        expect(options.raw).toBe(true);
        expect(options.attributes).toEqual(["id", "atlasSoma"]);
        expect(options.order).toEqual([["id", "ASC"]]);
        expect(options.limit).toBe(2001);
        expect(options.where).not.toHaveProperty("id");
        expect(options.include.find((include: any) => include.as === "Specimen").attributes).toEqual([]);
        expect(output.totalCount).toBe(42);
    });

    test("a later chunk continues after the cursor without counting", async () => {
        const after = neuronId(7);
        const {count, findAll} = stubQueries(42, rowsFor(3));

        const output = await Neuron.getCandidateNeuronLocations({}, false, undefined, after);

        const options = chunkOptions(findAll);

        expect(count).not.toHaveBeenCalled();
        expect(output.totalCount).toBeNull();
        expect(options.where.id[Op.gt]).toBe(after);
        expect(options.where[Op.and].length).toBeGreaterThan(0);
    });

    test("the extra row sets the cursor to the chunk's last id", async () => {
        stubQueries(3000, rowsFor(2001));

        const output = await Neuron.getCandidateNeuronLocations({});

        expect(output.ids).toHaveLength(2000);
        expect(output.locations).toHaveLength(2000);
        expect(output.nextCursor).toBe(output.ids[1999]);
    });

    test("a short chunk is the last", async () => {
        stubQueries(5, rowsFor(5));

        expect((await Neuron.getCandidateNeuronLocations({})).nextCursor).toBeNull();
    });

    test.each([
        {chunkSize: 50, limit: 51},
        {chunkSize: 5000, limit: 2001},
        {chunkSize: 0, limit: 2001},
        {chunkSize: -3, limit: 2001},
        {chunkSize: null, limit: 2001}
    ])("chunkSize $chunkSize reads $limit rows", async ({chunkSize, limit}) => {
        const {findAll} = stubQueries(0, []);

        await Neuron.getCandidateNeuronLocations({}, false, undefined, null, chunkSize);

        expect(chunkOptions(findAll).limit).toBe(limit);
    });

    test("an invalid cursor is refused before any query", async () => {
        const {count, findAll} = stubQueries(0, []);

        await expect(Neuron.getCandidateNeuronLocations({}, false, undefined, "not-a-uuid")).rejects.toThrow(/cursor/);

        expect(count).not.toHaveBeenCalled();
        expect(findAll).not.toHaveBeenCalled();
    });
});

describe("getCandidateNeuronLocations locations", () => {
    test("a location is a complete triple or null, aligned with its id", async () => {
        const somas = [{x: 1.5, y: 2, z: 3}, null, {x: 0, y: 0, z: 0}, {x: 1, y: null, z: 2}, {x: 1, y: 2}];

        stubQueries(5, somas.map((atlasSoma, index) => ({id: neuronId(index + 1), atlasSoma})));

        const output = await Neuron.getCandidateNeuronLocations({});

        expect(output.ids).toEqual([1, 2, 3, 4, 5].map(neuronId));
        expect(output.locations).toEqual([[1.5, 2, 3], null, [0, 0, 0], null, null]);
    });
});

describe("getCandidateNeuronLocations walk over a changing set", () => {
    test("never repeats an id and returns every unchanged candidate once", async () => {
        let candidates = [2, 4, 6, 8, 10].map(neuronId);

        vi.spyOn(Neuron, "count").mockImplementation(async () => candidates.length);
        vi.spyOn(Neuron, "findAll").mockImplementation(async (options: any) => {
            const after = options.where.id?.[Op.gt];

            return candidates.filter(id => !after || id > after).sort().slice(0, options.limit).map(id => ({id, atlasSoma: null}));
        });

        const first = await Neuron.getCandidateNeuronLocations({}, false, undefined, null, 2);

        expect(first.ids).toEqual([2, 4].map(neuronId));
        expect(first.totalCount).toBe(5);

        // 4 leaves after it was returned, 8 before it is reached, 3 enters behind the cursor, 9 and 12 ahead of it.
        candidates = [2, 3, 6, 9, 10, 12].map(neuronId);

        const walked = [...first.ids];
        let cursor = first.nextCursor;

        while (cursor) {
            const chunk = await Neuron.getCandidateNeuronLocations({}, false, undefined, cursor, 2);

            walked.push(...chunk.ids);
            cursor = chunk.nextCursor;
        }

        expect(walked).toEqual([2, 4, 6, 9, 10, 12].map(neuronId));
        expect(new Set(walked).size).toBe(walked.length);
        expect(walked).not.toContain(neuronId(8));
        expect(walked).not.toContain(neuronId(3));
        expect(walked.length).not.toBe(first.totalCount);
    });
});

describe("getCandidateNeuronLocations shares the table's filter", () => {
    test("the same arguments build the same predicates and replacements", async () => {
        const input = {keywords: ["axon"], specimenIds: ["specimen-1"]};

        const {findAll} = stubQueries(0, []);

        await Neuron.getCandidateNeurons(input, true, []);
        await Neuron.getCandidateNeuronLocations(input, true, []);

        const [table, locations] = findAll.mock.calls.map((call: any) => call[0]);

        expect(locations.where[Op.and].map((predicate: any) => predicate.val)).toEqual(table.where[Op.and].map((predicate: any) => predicate.val));
        expect(locations.where["$Specimen.id$"]).toEqual(table.where["$Specimen.id$"]);
        expect(locations.replacements).toEqual(table.replacements);
    });
});
