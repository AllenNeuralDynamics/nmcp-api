import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Neuron} = require("../src/models/neuron");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

function neuronStub() {
    const neuron = Object.create(Neuron.prototype);
    neuron.id = "neuron-1";
    return neuron;
}

afterEach(() => {
    vi.restoreAllMocks();
});

// Marking soft-deletes the row, so an untraceable reconstruction always carries a deletedAt.
const deleted = (status: number) => ({status, deletedAt: new Date()});
const live = (status: number) => ({status, deletedAt: null});

describe("Neuron.untraceable", () => {
    test.each([
        {label: "no reconstructions", rows: [], expected: false},
        {label: "one untraceable", rows: [deleted(ReconstructionStatus.Untraceable)], expected: true},
        {
            label: "two untraceable",
            rows: [deleted(ReconstructionStatus.Untraceable), deleted(ReconstructionStatus.Untraceable)],
            expected: true
        },
        {
            label: "untraceable plus a live initialized row",
            rows: [deleted(ReconstructionStatus.Untraceable), live(ReconstructionStatus.Initialized)],
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
        {label: "only an initialized row", rows: [live(ReconstructionStatus.Initialized)], expected: false}
    ])("$label -> $expected", async ({rows, expected}) => {
        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(rows);

        expect(await neuronStub().untraceable()).toBe(expected);
    });

    test("looks past the soft delete, for this neuron only", async () => {
        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await neuronStub().untraceable();

        const options = findAll.mock.calls[0][0] as any;

        expect(options.where).toEqual({neuronId: "neuron-1"});
        expect(options.paranoid).toBe(false);

        // deletedAt is what separates an untraceable row from a live one here, so narrowing the select without it
        // would silently make every row look live and the flag would never be true.
        expect(options.attributes).toContain("deletedAt");
    });
});
