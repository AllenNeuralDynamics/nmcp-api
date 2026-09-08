import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, PausableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function stub(status: number, user: any) {
    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
        configurable: true,
        writable: true
    });

    return {reconstruction, create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})};
}

const allStatuses = Object.keys(ReconstructionStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => ReconstructionStatus[key] as number);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("pauseReconstruction", () => {
    test.each(PausableSourceStatuses as number[])("allows source status %s", async (status: number) => {
        stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const updated = await Reconstruction.pauseReconstruction("reconstruction-1", "annotator-1");

        expect(updated.status).toBe(ReconstructionStatus.OnHold);
    });

    test.each(allStatuses.filter(status => !(PausableSourceStatuses as number[]).includes(status)))(
        "refuses source status %s even for an admin",
        async (status: number) => {
            const stubs = stub(status, userWith(UserPermissions.Admin));

            await expect(Reconstruction.pauseReconstruction("reconstruction-1", "user-1")).rejects.toThrow(/Cannot pause/);

            expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        });

    // The import reconciles a row the portal already left at OnHold, or at a status the portal refuses.
    test.each(allStatuses)("disregardAuth bypasses both the predicate and the source list, from %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.None, "importer-1"));

        const updated = await Reconstruction.pauseReconstruction("reconstruction-1", "importer-1", null, true);

        expect(updated.status).toBe(ReconstructionStatus.OnHold);
        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
    });

    test("records the pause event", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await Reconstruction.pauseReconstruction("reconstruction-1", "user-1");

        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.ReconstructionPause});
    });
});

describe("resumeReconstruction", () => {
    test("allows OnHold and writes InProgress", async () => {
        const stubs = stub(ReconstructionStatus.OnHold, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const updated = await Reconstruction.resumeReconstruction("reconstruction-1", "annotator-1");

        expect(updated.status).toBe(ReconstructionStatus.InProgress);
        expect(stubs.reconstruction.update).toHaveBeenCalledWith({status: ReconstructionStatus.InProgress}, expect.anything());
    });

    test.each(allStatuses.filter(status => status !== ReconstructionStatus.OnHold))(
        "refuses source status %s even for an admin",
        async (status: number) => {
            const stubs = stub(status, userWith(UserPermissions.Admin));

            await expect(Reconstruction.resumeReconstruction("reconstruction-1", "user-1")).rejects.toThrow(/Cannot resume/);

            expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        });

    test("records the resume event", async () => {
        const stubs = stub(ReconstructionStatus.OnHold, userWith(UserPermissions.Admin));

        await Reconstruction.resumeReconstruction("reconstruction-1", "user-1");

        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.ReconstructionResume});
    });
});
