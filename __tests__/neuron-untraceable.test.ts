import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron} = require("../src/models/neuron");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

afterEach(() => {
    vi.restoreAllMocks();
});

// Marking soft-deletes the row, so an untraceable reconstruction always carries a deletedAt.
const deleted = (status: number, neuronId: string = "neuron-1") => ({neuronId, status, deletedAt: new Date()});
const live = (status: number, neuronId: string = "neuron-1") => ({neuronId, status, deletedAt: null});

describe("Neuron.untraceableByNeuron", () => {
    test.each([
        {label: "no reconstructions", rows: [], expected: false},
        {label: "one untraceable", rows: [deleted(ReconstructionStatus.Untraceable)], expected: true},
        {
            label: "two untraceable",
            rows: [deleted(ReconstructionStatus.Untraceable), deleted(ReconstructionStatus.Untraceable)],
            expected: true
        },
        {
            label: "untraceable plus a discarded row",
            rows: [deleted(ReconstructionStatus.Untraceable), deleted(ReconstructionStatus.Discarded)],
            expected: true
        },
        {
            label: "untraceable plus a live replacement",
            rows: [deleted(ReconstructionStatus.Untraceable), live(ReconstructionStatus.InProgress)],
            expected: false
        },
        {
            label: "untraceable plus a published row",
            rows: [deleted(ReconstructionStatus.Untraceable), live(ReconstructionStatus.Published)],
            expected: false
        },
        {label: "only a live row", rows: [live(ReconstructionStatus.InProgress)], expected: false}
    ])("$label -> $expected", async ({rows, expected}) => {
        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(rows);

        expect(await Neuron.untraceableByNeuron(["neuron-1"])).toEqual([expected]);
    });

    test("looks past the soft delete, for the requested neurons only", async () => {
        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await Neuron.untraceableByNeuron(["neuron-1"]);

        const options = findAll.mock.calls[0][0] as any;

        expect(options.where).toEqual({neuronId: {[Op.in]: ["neuron-1"]}});
        expect(options.paranoid).toBe(false);

        // deletedAt is what separates an untraceable row from a live one here, so narrowing the select without it
        // would silently make every row look live and the flag would never be true.
        expect(options.attributes).toContain("deletedAt");
        expect(options.attributes).toContain("neuronId");
    });

    test("answers each neuron from its own rows, in the order asked", async () => {
        vi.spyOn(Reconstruction, "findAll").mockResolvedValue([
            deleted(ReconstructionStatus.Untraceable, "neuron-2"),
            live(ReconstructionStatus.InProgress, "neuron-1")
        ]);

        expect(await Neuron.untraceableByNeuron(["neuron-1", "neuron-2", "neuron-3"])).toEqual([false, true, false]);
    });
});
