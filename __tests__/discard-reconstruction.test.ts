import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, DiscardableSourceStatuses, AdminDiscardableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {SpecimenNode} = require("../src/models/specimenNode");
const {EventLogItem} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"};

const abandonableFailures = [
    AtlasReconstructionStatus.FailedQualityControl,
    AtlasReconstructionStatus.FailedStructureAssignment,
    AtlasReconstructionStatus.FailedPrecomputed,
    AtlasReconstructionStatus.FailedDoiAssignment
];

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function stub(status: number, user: any, childStatus: number = AtlasReconstructionStatus.Initialized) {
    const atlasReconstruction = {id: "atlas-1", status: childStatus};

    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.AtlasReconstruction = atlasReconstruction;
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });
    reconstruction.destroy = vi.fn();

    const findByPk = vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    const findAtlas = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any);

    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    return {
        reconstruction: reconstruction,
        findByPk: findByPk,
        findAtlas: findAtlas,
        discardForReconstruction: vi.spyOn(AtlasReconstruction, "discardForReconstruction").mockResolvedValue(undefined),
        destroyNodes: vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0),
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("discardReconstruction as the annotator", () => {
    test.each(DiscardableSourceStatuses as number[])("discards from %s", async (status: number) => {
        stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "annotator-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });

    test.each(AdminDiscardableSourceStatuses as number[])("is refused at %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await expect(Reconstruction.discardReconstruction("reconstruction-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
    });
});

describe("discardReconstruction as an admin", () => {
    test.each([...DiscardableSourceStatuses, ...AdminDiscardableSourceStatuses] as number[])("discards from %s", async (status: number) => {
        stub(status, userWith(UserPermissions.Admin));

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });
});

/**
 * B1 and B2: the ways out of a pipeline that cannot finish, and of a result a reviewer decides should not be published.
 * Both are "PublishReview holder or admin" - a third permission shape neither existing source list expresses, and
 * specifically not the annotator's.
 */
describe("discardReconstruction past approval", () => {
    test.each(abandonableFailures)("a publish reviewer discards a child stopped at %s", async (childStatus: number) => {
        stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.PublishReview), childStatus);

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });

    test.each(abandonableFailures)("an admin discards a child stopped at %s", async (childStatus: number) => {
        stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.Admin), childStatus);

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });

    test.each([
        ["a publish reviewer", UserPermissions.PublishReview],
        ["an admin", UserPermissions.Admin]
    ])("%s discards from ReadyToPublish", async (_label: string, permissions: number) => {
        stub(ReconstructionStatus.ReadyToPublish, userWith(permissions), AtlasReconstructionStatus.ReadyToPublish);

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });

    test.each([...abandonableFailures.map(status => [ReconstructionStatus.WaitingForAtlasReconstruction, status]),
        [ReconstructionStatus.ReadyToPublish, AtlasReconstructionStatus.ReadyToPublish]])(
        "the annotator alone is refused at parent %s, child %s",
        async (status: number, childStatus: number) => {
            const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"), childStatus);

            await expect(Reconstruction.discardReconstruction("reconstruction-1", "annotator-1"))
                .rejects.toBeInstanceOf(UnauthorizedError);

            expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
        });

    test("tears down the same way on the new route", async () => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.PublishReview), AtlasReconstructionStatus.FailedDoiAssignment);

        await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(stubs.discardForReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.destroyNodes).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.destroy).toHaveBeenCalledTimes(1);
    });
});

describe("discardReconstruction refused statuses", () => {
    // The status problem is reported as such rather than as Unauthorized, whoever is asking.
    test.each([
        ReconstructionStatus.Approved,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.PublishFailed,
        ReconstructionStatus.Archived
    ])("refuses %s for everyone, with the status-shaped error", async (status: number) => {
        for (const user of [userWith(UserPermissions.Admin), userWith(UserPermissions.AnnotateOne, "annotator-1")]) {
            vi.restoreAllMocks();

            const stubs = stub(status, user);

            await expect(Reconstruction.discardReconstruction("reconstruction-1", user.id))
                .rejects.toThrow(/Cannot discard a reconstruction/);

            expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
        }
    });

    // The pairing reject now admits, and the one discard must go on refusing: B3 hands PublishFailed a single route
    // back and it is not this one.  Throwing away a reconstruction that got as far as publishing is a reject followed
    // by an ordinary discard from Rejected, which is two deliberate acts rather than one.
    test("refuses a PublishFailed parent whose child failed indexing, which reject now admits", async () => {
        const stubs = stub(ReconstructionStatus.PublishFailed, userWith(UserPermissions.Admin), AtlasReconstructionStatus.FailedSearchIndexing);

        await expect(Reconstruction.discardReconstruction("reconstruction-1", "user-1"))
            .rejects.toThrow(/Cannot discard a reconstruction/);

        expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
    });

    // WaitingForAtlasReconstruction is not blanket-discardable: a reconstruction with a phase actually running, or one
    // whose only failure is in indexing, is not abandonable.
    //
    // The parent/child pairing is synthetic and deliberately so: WaitingForAtlasReconstruction is the only parent
    // status at which isDiscardable consults the child list at all, so pairing it with FailedSearchIndexing is the
    // strongest available form of "indexing failures are not abandonable".  Changing the parent to PublishFailed would
    // exercise the plain source-status branch instead - covered by the table above - and silently drop this coverage.
    test.each([
        AtlasReconstructionStatus.PendingQualityControl,
        AtlasReconstructionStatus.InQualityControl,
        AtlasReconstructionStatus.InStructureAssignment,
        AtlasReconstructionStatus.InDoiAssignment,
        AtlasReconstructionStatus.FailedSearchIndexing
    ])("refuses a child at %s with the status-shaped error", async (childStatus: number) => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.Admin), childStatus);

        await expect(Reconstruction.discardReconstruction("reconstruction-1", "user-1"))
            .rejects.toThrow(/Cannot discard a reconstruction/);

        expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
    });
});

describe("discardReconstruction teardown", () => {
    test("soft-deletes the reconstruction and everything downstream of it", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Reconstruction.discardReconstruction("reconstruction-1", "annotator-1");

        expect(stubs.discardForReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.destroyNodes).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.destroy).toHaveBeenCalledTimes(1);
    });

    test("still tears down on the admin-only route", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(stubs.discardForReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.destroyNodes).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.destroy).toHaveBeenCalledTimes(1);
    });
});

describe("discardReconstruction serialization", () => {
    test("locks the child before the parent, inside the one transaction", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Reconstruction.discardReconstruction("reconstruction-1", "annotator-1");

        expect(stubs.findAtlas).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        const lockedParentCall = stubs.findByPk.mock.calls.findIndex((call: any) => call[1]?.lock === Transaction.LOCK.UPDATE);

        expect(lockedParentCall).toBeGreaterThanOrEqual(0);
        expect(stubs.findAtlas.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.findByPk.mock.invocationCallOrder[lockedParentCall]);
    });
});
