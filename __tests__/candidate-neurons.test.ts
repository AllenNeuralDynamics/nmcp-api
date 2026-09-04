import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron} = require("../src/models/neuron");
const {Reconstruction, CandidateBlockingStatuses, PublishedCandidateBlockingStatuses} = require("../src/models/reconstruction");
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

    // optionsWhereAtlasStructureIds resolves structures through the default atlas, which is null until a cache load
    // that never happens in tests.
    Atlas.defaultAtlas = {getFromStructureId: () => null};

    return findAll;
}

function stubReconstructions(rows: { neuronId: string, status: number }[]) {
    // The query is the model's own filter, so the stub applies it rather than returning everything.
    return vi.spyOn(Reconstruction, "findAll").mockImplementation(async (options: any) => {
        const blocking = options.where.status[Op.in] as number[];
        return rows.filter(row => blocking.includes(row.status)) as any;
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    Atlas.defaultAtlas = null;
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
    // The rows F5 was losing neurons to: a paused or archived attempt no longer holds its neuron.
    test.each([ReconstructionStatus.OnHold, ReconstructionStatus.Archived])(
        "a neuron whose only row is %s is a candidate either way",
        async (status: number) => {
            for (const includeInProgress of [false, true]) {
                vi.restoreAllMocks();
                stubNeurons(["neuron-1"]);
                stubReconstructions([{neuronId: "neuron-1", status: status}]);

                const output = await Neuron.getCandidateNeurons({}, includeInProgress);

                expect(output.items.map((neuron: any) => neuron.id)).toEqual(["neuron-1"]);
            }
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
