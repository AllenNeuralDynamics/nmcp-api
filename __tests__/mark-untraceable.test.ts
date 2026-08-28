import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, UntraceableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenNode} = require("../src/models/specimenNode");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function reconstructionStub(status: number) {
    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });
    reconstruction.destroy = vi.fn();
    return reconstruction;
}

function stub(status: number, user: any) {
    const reconstruction = reconstructionStub(status);

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    // markUntraceable uses the callback form of transaction(), so the stub has to invoke the callback.  Model.sequelize
    // is a readonly static assigned during init(), which never runs here, so define it rather than assign it.
    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
        configurable: true,
        writable: true
    });

    return {
        reconstruction: reconstruction,
        discardForReconstruction: vi.spyOn(AtlasReconstruction, "discardForReconstruction").mockResolvedValue(undefined),
        destroyNodes: vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0),
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("markUntraceable authorization", () => {
    test.each([
        ["an admin", UserPermissions.Admin, "user-1"],
        ["the row's own annotator", UserPermissions.AnnotateOne, "annotator-1"],
        ["a peer reviewer", UserPermissions.PeerReview, "user-1"],
        ["a publish reviewer", UserPermissions.PublishReview, "user-1"]
    ])("allows %s", async (_label: string, permissions: number, id: string) => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(permissions, id));

        const reconstruction = await Reconstruction.markUntraceable("reconstruction-1", "user-1");

        expect(reconstruction.status).toBe(ReconstructionStatus.Untraceable);
        expect(stubs.reconstruction.update).toHaveBeenCalledWith({status: ReconstructionStatus.Untraceable}, expect.anything());
    });

    test("refuses an annotator who does not own the reconstruction", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-2"));

        await expect(Reconstruction.markUntraceable("reconstruction-1", "annotator-2")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("refuses when there is no user", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, null);

        await expect(Reconstruction.markUntraceable("reconstruction-1", "user-1")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("markUntraceable source status", () => {
    test.each(UntraceableSourceStatuses as number[])("allows source status %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await Reconstruction.markUntraceable("reconstruction-1", "user-1");

        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
    });

    test.each([
        ReconstructionStatus.Approved,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Rejected,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived,
        ReconstructionStatus.Untraceable,
        ReconstructionStatus.Discarded
    ])("refuses source status %s even for an admin", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Reconstruction.markUntraceable("reconstruction-1", "user-1")).rejects.toThrow(/as untraceable/);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("disregardAuth bypasses both the predicate and the source-status list", async () => {
        const stubs = stub(ReconstructionStatus.Published, userWith(UserPermissions.None, "annotator-2"));

        await Reconstruction.markUntraceable("reconstruction-1", "annotator-2", null, true);

        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
    });
});

describe("markUntraceable teardown", () => {
    test("soft-deletes the reconstruction and everything downstream of it", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await Reconstruction.markUntraceable("reconstruction-1", "user-1");

        expect(stubs.reconstruction.destroy).toHaveBeenCalledTimes(1);
        expect(stubs.discardForReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.destroyNodes).toHaveBeenCalledTimes(1);
        expect((stubs.destroyNodes.mock.calls[0][0] as any).where).toEqual({reconstructionId: "reconstruction-1"});
    });

    test("records the event under its own kind", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await Reconstruction.markUntraceable("reconstruction-1", "user-1");

        expect(stubs.create).toHaveBeenCalledTimes(1);
        expect(stubs.create.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.ReconstructionUntraceable,
            name: "ReconstructionUntraceable",
            targetId: "reconstruction-1"
        });
    });

    test("sets the status before deleting, so the row is identifiable afterwards", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await Reconstruction.markUntraceable("reconstruction-1", "user-1");

        expect(stubs.reconstruction.update.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.reconstruction.destroy.mock.invocationCallOrder[0]);
    });
});
