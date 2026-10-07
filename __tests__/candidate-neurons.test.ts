import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron} = require("../src/models/neuron");
const {Reconstruction, CandidateBlockingStatuses, PublishedCandidateBlockingStatuses, CandidateExcludedStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {Atlas} = require("../src/models/atlas");

// getCandidateNeurons runs two Neuron.findAll calls: the id sweep first, then the filtered page.  The second is what
// carries the candidate set, so the stub answers by call order.
function stubNeurons(allNeuronIds: string[]) {
    const findAll = vi.spyOn(Neuron, "findAll");

    findAll.mockResolvedValueOnce(allNeuronIds.map(id => ({id})) as any);
    findAll.mockImplementation(async (options: any) => (options.where.id[Op.in] as string[]).map(id => ({id})) as any);

    // setSortAndLimiting runs a count against the database; the candidate ids are already in the options by then.
    vi.spyOn(Neuron as any, "setSortAndLimiting").mockResolvedValue(0);

    return findAll;
}

// deleted marks a soft-deleted row, as an untraceable one is: only a query with paranoid: false sees it.
function stubReconstructions(rows: { neuronId: string, status: number, deleted?: boolean }[]) {
    // The query is the model's own filter, so the stub applies it rather than returning everything.
    return vi.spyOn(Reconstruction, "findAll").mockImplementation(async (options: any) => {
        const statuses = options.where.status[Op.in] as number[];
        return rows.filter(row => statuses.includes(row.status) && (!row.deleted || options.paranoid === false)) as any;
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("getCandidateNeurons blocking statuses", () => {
    test("the default filters on every status that holds a neuron", async () => {
        stubNeurons([]);
        const findAll = stubReconstructions([]);

        await Neuron.getCandidateNeurons({});

        expect(findAll.mock.calls[0][0].where.status[Op.in]).toBe(CandidateBlockingStatuses);
    });

    test("includeInProgress filters on the published-only list", async () => {
        stubNeurons([]);
        const findAll = stubReconstructions([]);

        await Neuron.getCandidateNeurons({}, true);

        expect(findAll.mock.calls[0][0].where.status[Op.in]).toBe(PublishedCandidateBlockingStatuses);
    });
});

describe("getCandidateNeurons results", () => {
    // The rows F5 was losing neurons to: a held or archived attempt no longer holds its neuron.  Incomplete and
    // Duplicate are excluded by default, so they are released only once nothing is excluded.
    test.each([ReconstructionStatus.OnHold, ReconstructionStatus.Incomplete, ReconstructionStatus.Duplicate, ReconstructionStatus.Archived])(
        "a neuron whose only row is %s is not blocked either way",
        async (status: number) => {
            for (const includeInProgress of [false, true]) {
                vi.restoreAllMocks();
                stubNeurons(["neuron-1"]);
                stubReconstructions([{neuronId: "neuron-1", status: status}]);

                const output = await Neuron.getCandidateNeurons({}, includeInProgress, []);

                expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-1"]);
            }
        });

    test.each([ReconstructionStatus.OnHold, ReconstructionStatus.Archived])(
        "a neuron whose only row is %s is a candidate by default",
        async (status: number) => {
            stubNeurons(["neuron-1"]);
            stubReconstructions([{neuronId: "neuron-1", status: status}]);

            const output = await Neuron.getCandidateNeurons({});

            expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-1"]);
        });

    test.each([ReconstructionStatus.Rejected, ReconstructionStatus.Publishing])(
        "a neuron with a %s row is held out by default",
        async (status: number) => {
            stubNeurons(["neuron-1", "neuron-2"]);
            stubReconstructions([{neuronId: "neuron-1", status: status}]);

            const output = await Neuron.getCandidateNeurons({});

            expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-2"]);
        });

    test("a Rejected row releases the neuron once only a publication counts", async () => {
        stubNeurons(["neuron-1"]);
        stubReconstructions([{neuronId: "neuron-1", status: ReconstructionStatus.Rejected}]);

        const output = await Neuron.getCandidateNeurons({}, true);

        expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-1"]);
    });

    test("a Publishing row still holds the neuron out once only a publication counts", async () => {
        stubNeurons(["neuron-1"]);
        stubReconstructions([{neuronId: "neuron-1", status: ReconstructionStatus.Publishing}]);

        const output = await Neuron.getCandidateNeurons({}, true);

        expect(output.items).toEqual([]);
    });

    // A row at a blocking status holds its neuron out whatever its siblings are at.
    test("a Published row holds the neuron out even beside an OnHold one", async () => {
        stubNeurons(["neuron-1"]);
        stubReconstructions([
            {neuronId: "neuron-1", status: ReconstructionStatus.OnHold},
            {neuronId: "neuron-1", status: ReconstructionStatus.Published}
        ]);

        const output = await Neuron.getCandidateNeurons({});

        expect(output.items).toEqual([]);
    });
});

describe("getCandidateNeurons structure filter", () => {
    const atlas = {id: "atlas-1", getComprehensiveBrainArea: (structureId: string) => structureId === "region-a" ? ["region-a", "region-a-child"] : null};

    function stubAtlas() {
        vi.spyOn(Atlas, "getAtlasForStructure").mockImplementation((structureId: any) => structureId === "region-a" ? atlas : null);
    }

    test("filters on the owning atlas's subtree", async () => {
        const findAll = stubNeurons(["neuron-1"]);
        stubReconstructions([]);
        stubAtlas();

        await Neuron.getCandidateNeurons({atlasStructureIds: ["region-a"]});

        expect(findAll.mock.calls[1][0].where.atlasStructureId[Op.in]).toEqual(["region-a", "region-a-child"]);
    });

    test("an unknown structure id is rejected", async () => {
        stubNeurons(["neuron-1"]);
        stubReconstructions([]);
        stubAtlas();

        await expect(Neuron.getCandidateNeurons({atlasStructureIds: ["missing-id"]})).rejects.toThrow(/Atlas structures not found/);
    });
});

describe("getCandidateNeurons excluded reconstruction statuses", () => {
    test("the default excludes Untraceable, Duplicate and Incomplete, reading soft-deleted rows", async () => {
        stubNeurons([]);
        const findAll = stubReconstructions([]);

        await Neuron.getCandidateNeurons({});

        const options = findAll.mock.calls[1][0];

        expect(options.where.status[Op.in]).toBe(CandidateExcludedStatuses);
        expect([...CandidateExcludedStatuses].sort()).toEqual([
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.Incomplete
        ].sort());
        expect(options.paranoid).toBe(false);
    });

    test.each([
        {status: ReconstructionStatus.Untraceable, deleted: true},
        {status: ReconstructionStatus.Duplicate, deleted: false},
        {status: ReconstructionStatus.Incomplete, deleted: false}
    ])("a neuron with a $status row is left out by default", async ({status, deleted}) => {
        stubNeurons(["neuron-1", "neuron-2"]);
        stubReconstructions([{neuronId: "neuron-1", status: status, deleted: deleted}]);

        const output = await Neuron.getCandidateNeurons({});

        expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-2"]);
    });

    test("an explicit list replaces the default", async () => {
        stubNeurons(["neuron-1", "neuron-2", "neuron-3"]);
        stubReconstructions([
            {neuronId: "neuron-1", status: ReconstructionStatus.OnHold},
            {neuronId: "neuron-2", status: ReconstructionStatus.Duplicate},
        ]);

        const output = await Neuron.getCandidateNeurons({}, false, [ReconstructionStatus.OnHold]);

        expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-2", "neuron-3"]);
    });

    test("an empty list excludes nothing and skips the query", async () => {
        stubNeurons(["neuron-1"]);
        const findAll = stubReconstructions([{neuronId: "neuron-1", status: ReconstructionStatus.Untraceable, deleted: true}]);

        const output = await Neuron.getCandidateNeurons({}, false, []);

        expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-1"]);
        expect(findAll).toHaveBeenCalledTimes(1);
    });

    // Independent of the blocking lists: excluding nothing does not release a blocked neuron.
    test("blocking still applies whatever is excluded", async () => {
        stubNeurons(["neuron-1"]);
        stubReconstructions([{neuronId: "neuron-1", status: ReconstructionStatus.InProgress}]);

        const output = await Neuron.getCandidateNeurons({}, false, []);

        expect(output.items).toEqual([]);
    });

    test("excludes alongside includeInProgress", async () => {
        stubNeurons(["neuron-1", "neuron-2"]);
        stubReconstructions([
            {neuronId: "neuron-1", status: ReconstructionStatus.InProgress},
            {neuronId: "neuron-2", status: ReconstructionStatus.Duplicate}
        ]);

        const output = await Neuron.getCandidateNeurons({}, true);

        expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-1"]);
    });
});
