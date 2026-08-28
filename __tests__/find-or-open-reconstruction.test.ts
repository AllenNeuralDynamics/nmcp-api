import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one findOrOpenReconstruction calls into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, ClosedReconstructionStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

const order = [["createdAt", "DESC"]];

function annotator() {
    const user = Object.create(User.prototype);
    user.id = "annotator-1";
    user.permissions = UserPermissions.AnnotateOne;
    return user;
}

function stub(...results: any[]) {
    // A base resolution matters: without one the spy calls through to the real finder once the queued results run out.
    const findOne = vi.spyOn(Reconstruction, "findOne").mockResolvedValue(null);

    for (const result of results) {
        findOne.mockResolvedValueOnce(result);
    }

    return {
        findOne: findOne,
        openReconstruction: vi.spyOn(Reconstruction, "openReconstruction").mockResolvedValue([{id: "created-1"}, false])
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("findOrOpenReconstruction", () => {
    test("returns the annotator's open row without a second query", async () => {
        const stubs = stub({id: "open-1"});

        const reconstruction = await Reconstruction.findOrOpenReconstruction("neuron-1", annotator());

        expect(reconstruction.id).toBe("open-1");
        expect(stubs.findOne).toHaveBeenCalledTimes(1);
        expect(stubs.openReconstruction).not.toHaveBeenCalled();
    });

    test("falls back to a closed row rather than creating another", async () => {
        const stubs = stub(null, {id: "published-1"});

        const reconstruction = await Reconstruction.findOrOpenReconstruction("neuron-1", annotator());

        expect(reconstruction.id).toBe("published-1");
        expect(stubs.openReconstruction).not.toHaveBeenCalled();
    });

    test("opens a reconstruction when the annotator has no row on the neuron", async () => {
        const user = annotator();
        const substitute = Object.create(User.prototype);
        const stubs = stub(null, null);

        const reconstruction = await Reconstruction.findOrOpenReconstruction("neuron-1", user, substitute);

        expect(reconstruction.id).toBe("created-1");
        expect(stubs.openReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.openReconstruction).toHaveBeenCalledWith("neuron-1", user, null, substitute, false);
    });

    test("queries newest-first, open rows before any row", async () => {
        const stubs = stub(null, null);

        await Reconstruction.findOrOpenReconstruction("neuron-1", annotator());

        const [open, any] = stubs.findOne.mock.calls.map(call => call[0] as any);

        expect(open.where.annotatorId).toBe("annotator-1");
        expect(open.where.neuronId).toBe("neuron-1");
        expect(open.where.status[Op.notIn]).toBe(ClosedReconstructionStatuses);
        expect(open.order).toEqual(order);

        expect(any.where).toEqual({annotatorId: "annotator-1", neuronId: "neuron-1"});
        expect(any.order).toEqual(order);
    });

    test("refuses a user who can not view data", async () => {
        const user = Object.create(User.prototype);
        user.id = "annotator-1";
        user.permissions = UserPermissions.None;

        await expect(Reconstruction.findOrOpenReconstruction("neuron-1", user)).rejects.toThrow();
    });
});

describe("findOrOpenReconstruction with includeUntraceable", () => {
    test("returns the soft-deleted untraceable row rather than opening another", async () => {
        const stubs = stub(null, null, {id: "untraceable-1"});

        const reconstruction = await Reconstruction.findOrOpenReconstruction("neuron-1", annotator(), null, true);

        expect(reconstruction.id).toBe("untraceable-1");
        expect(stubs.openReconstruction).not.toHaveBeenCalled();
    });

    test("looks past the soft delete only for untraceable rows, and only on the third query", async () => {
        const stubs = stub(null, null, null);

        await Reconstruction.findOrOpenReconstruction("neuron-1", annotator(), null, true);

        const calls = stubs.findOne.mock.calls.map(call => call[0] as any);

        expect(calls).toHaveLength(3);
        expect(calls[0].paranoid).toBeUndefined();
        expect(calls[1].paranoid).toBeUndefined();
        expect(calls[2].paranoid).toBe(false);
        expect(calls[2].where.status).toBe(ReconstructionStatus.Untraceable);
        expect(calls[2].order).toEqual(order);
    });

    test("is opt-in - the default never issues a paranoid read", async () => {
        const stubs = stub(null, null);

        await Reconstruction.findOrOpenReconstruction("neuron-1", annotator());

        expect(stubs.findOne).toHaveBeenCalledTimes(2);
        expect(stubs.openReconstruction).toHaveBeenCalledTimes(1);
    });
});
