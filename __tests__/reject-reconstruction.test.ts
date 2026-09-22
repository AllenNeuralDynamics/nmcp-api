import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
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

function stub(status: number, user: any, childStatus: number = AtlasReconstructionStatus.ReadyToPublish) {
    const atlasReconstruction = {
        id: "atlas-1",
        status: childStatus,
        reject: vi.fn().mockResolvedValue(undefined)
    };

    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.AtlasReconstruction = atlasReconstruction;
    // Reproduces Model.prototype.update's in-place mutation, which is what made the atlas-side branch unreachable.
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });

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
        atlasReconstruction: atlasReconstruction,
        findByPk: findByPk,
        findAtlas: findAtlas,
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("rejectReconstruction from publish review", () => {
    test("rejects the atlas reconstruction as well", async () => {
        const user = userWith(UserPermissions.Admin);
        const stubs = stub(ReconstructionStatus.PublishReview, user);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledTimes(1);
        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledWith(user, transaction);
    });

    test("does not assign a reviewer", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({status: ReconstructionStatus.Rejected});
    });
});

describe("rejectReconstruction from other allowed sources", () => {
    test("a peer review source assigns the reviewer and leaves the child alone", async () => {
        const user = userWith(UserPermissions.Admin);
        const stubs = stub(ReconstructionStatus.PeerReview, user, AtlasReconstructionStatus.Initialized);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({
            status: ReconstructionStatus.Rejected,
            reviewerId: user.id
        });
    });

    /**
     * The second rule with no diff behind it.  AtlasReconstruction.reject unconditionally writes reviewerId, and that
     * field is the publish reviewer the DOI credits, so neither optional review may reach the child - the rewind is
     * gated on an explicit two-status test rather than on "every source but peer review".
     */
    test("a team review source assigns the team reviewer and leaves the child alone", async () => {
        const user = userWith(UserPermissions.TeamReview);
        const stubs = stub(ReconstructionStatus.TeamReview, user, AtlasReconstructionStatus.Initialized);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({
            status: ReconstructionStatus.Rejected,
            teamReviewerId: user.id
        });
    });

    // A1: past approval the child records who stopped it, rather than going on naming only the publish reviewer who
    // approved it.
    test("a ready-to-publish source rejects the child too", async () => {
        const user = userWith(UserPermissions.PublishReview);
        const stubs = stub(ReconstructionStatus.ReadyToPublish, user);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledWith(user, transaction);
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({status: ReconstructionStatus.Rejected});
    });

    test.each(abandonableFailures)("a failed child at %s is rejectable by a publish reviewer", async (childStatus: number) => {
        const user = userWith(UserPermissions.PublishReview);
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction, user, childStatus);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.Rejected);
        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledWith(user, transaction);
    });

    test.each([
        ["peer review", ReconstructionStatus.PeerReview],
        ["team review", ReconstructionStatus.TeamReview],
        ["publish review", ReconstructionStatus.PublishReview],
        ["ready to publish", ReconstructionStatus.ReadyToPublish]
    ])("records the reject event for a %s source", async (_label: string, status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.create.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.ReconstructionReject,
            targetId: "reconstruction-1"
        });
    });
});

// B3: a reconstruction stuck at PublishFailed can be given up on rather than only retried.  What this recovers is the
// neuron - PublishFailed is in PublishedCandidateBlockingStatuses and Rejected is not, so the siblings stop being
// blocked - and not the search index, which the failed publish already archived and de-indexed.
describe("rejectReconstruction from a failed search index", () => {
    test.each([
        ["publish reviewer", UserPermissions.PublishReview],
        ["admin", UserPermissions.Admin]
    ])("a %s may reject a PublishFailed parent whose child failed indexing", async (_label: string, permissions: number) => {
        const user = userWith(permissions);
        const stubs = stub(ReconstructionStatus.PublishFailed, user, AtlasReconstructionStatus.FailedSearchIndexing);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.Rejected);
        // The source is not PeerReview, so the child is rewound to ReadyToProcess as it is from any post-approval
        // reject, and no reviewer is recorded.
        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledWith(user, transaction);
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({status: ReconstructionStatus.Rejected});
    });

    test("records the reject event", async () => {
        const stubs = stub(ReconstructionStatus.PublishFailed, userWith(UserPermissions.PublishReview), AtlasReconstructionStatus.FailedSearchIndexing);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.create.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.ReconstructionReject,
            targetId: "reconstruction-1"
        });
    });

    // The clause is the pair, not the parent status: any other child at PublishFailed is still refused.
    test.each([
        AtlasReconstructionStatus.FailedQualityControl,
        AtlasReconstructionStatus.FailedPrecomputed,
        AtlasReconstructionStatus.Published
    ])("refuses a PublishFailed parent whose child is at %s", async (childStatus: number) => {
        const stubs = stub(ReconstructionStatus.PublishFailed, userWith(UserPermissions.Admin), childStatus);

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toThrow(/Cannot reject a reconstruction with status/);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
    });

    test("an annotator still may not", async () => {
        const stubs = stub(ReconstructionStatus.PublishFailed, userWith(UserPermissions.AnnotateOne, "annotator-1"), AtlasReconstructionStatus.FailedSearchIndexing);

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("rejectReconstruction refusals", () => {
    test.each([
        ["approved", ReconstructionStatus.Approved],
        ["publishing", ReconstructionStatus.Publishing],
        ["published", ReconstructionStatus.Published],
        ["archived", ReconstructionStatus.Archived],
        ["in progress", ReconstructionStatus.InProgress],
        ["publish failed", ReconstructionStatus.PublishFailed]
    ])("refuses a %s source even for an admin", async (_label: string, status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toThrow(/Cannot reject a reconstruction with status/);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
    });

    // A publish reviewer fails the permission gate before the status test, so the two errors have different causes -
    // the admin above gets the status-shaped one.  Both are worth pinning: the child here is at ReadyToPublish, and
    // PublishFailed is a reject source only for the FailedSearchIndexing pairing below.
    test("refuses a publish reviewer at PublishFailed with a child that did not fail indexing", async () => {
        const stubs = stub(ReconstructionStatus.PublishFailed, userWith(UserPermissions.PublishReview));

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    // FailedSearchIndexing is not a member of AbandonableFailureStatuses and does not become one: the new route is a
    // clause on the PublishFailed parent alone, so the set that discard and the replay share keeps its meaning.
    //
    // The parent/child pairing here is synthetic and deliberately so: WaitingForAtlasReconstruction is the only parent
    // status at which isRejectable consults that list at all.  Changing the parent to PublishFailed would exercise the
    // new clause instead and silently drop this coverage.
    test("refuses a child at FailedSearchIndexing", async () => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.PublishReview), AtlasReconstructionStatus.FailedSearchIndexing);

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    // A phase actually running is not abandonable: the worker would complete it over the rewind.
    test.each([
        AtlasReconstructionStatus.InQualityControl,
        AtlasReconstructionStatus.InStructureAssignment,
        AtlasReconstructionStatus.InDoiAssignment,
        AtlasReconstructionStatus.PendingQualityControl
    ])("refuses a child at %s", async (childStatus: number) => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.PublishReview), childStatus);

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test.each([ReconstructionStatus.PeerReview, ReconstructionStatus.TeamReview, ReconstructionStatus.PublishReview])(
        "refuses a user with no review permission at %s",
        async (status: number) => {
            const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

            await expect(Reconstruction.rejectReconstruction("reconstruction-1", "annotator-1"))
                .rejects.toBeInstanceOf(UnauthorizedError);

            expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        });

    // Which actor may reject depends on the status, so a bit does not travel between review stages.
    test.each([
        [UserPermissions.PeerReview, ReconstructionStatus.TeamReview],
        [UserPermissions.TeamReview, ReconstructionStatus.PeerReview],
        [UserPermissions.TeamReview, ReconstructionStatus.PublishReview],
        [UserPermissions.PublishReview, ReconstructionStatus.TeamReview]
    ])("refuses permission %i at status %i", async (permissions: number, status: number) => {
        const stubs = stub(status, userWith(permissions));

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    // The annotator has no business abandoning a reconstruction that is past approval and inside the pipeline.
    test.each(abandonableFailures)("refuses the annotator at a child status of %s", async (childStatus: number) => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.AnnotateOne, "annotator-1"), childStatus);

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("rejectReconstruction serialization", () => {
    test("locks the child before the parent, inside the one transaction", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

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

/**
 * The child rewind itself.  A revised reconstruction re-enters the pipeline rather than resuming mid-way, so the reject
 * goes one step further back than the reset does - to ReadyToProcess, which under the approval guard is precisely the
 * approvable state.
 */
describe("AtlasReconstruction.reject", () => {
    function child(status: number) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: status,
            doi: "10.60533/nmcp-1",
            failureReason: "unexpected TypeError during structure assignment",
            failedAt: new Date("2026-03-01"),
            nodeStructureAssignmentAt: new Date("2026-03-01")
        });

        instance.update = vi.fn().mockImplementation(async (update: any) => {
            Object.assign(instance, update);
            return instance;
        });

        return instance;
    }

    test.each([...abandonableFailures, AtlasReconstructionStatus.ReadyToPublish])(
        "rewinds a child at %s to ReadyToProcess with the failure metadata cleared",
        async (status: number) => {
            const atlasReconstruction = child(status);

            await atlasReconstruction.reject(userWith(UserPermissions.PublishReview, "rejector-1"), transaction);

            expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.ReadyToProcess);
            expect(atlasReconstruction.failureReason).toBeNull();
            expect(atlasReconstruction.failedAt).toBeNull();
            expect(atlasReconstruction.nodeStructureAssignmentAt).toBeNull();
            expect(atlasReconstruction.reviewerId).toBe("rejector-1");
        });

    // The DOI is an external resource and is never unwound.
    test("leaves the DOI alone", async () => {
        const atlasReconstruction = child(AtlasReconstructionStatus.ReadyToPublish);

        await atlasReconstruction.reject(userWith(UserPermissions.PublishReview), transaction);

        expect(atlasReconstruction.doi).toBe("10.60533/nmcp-1");
    });

    // A child that never received atlas data would otherwise be claimed to hold node counts it does not have.
    test("records the rejector but leaves the status of a child that never received data", async () => {
        const atlasReconstruction = child(AtlasReconstructionStatus.Initialized);

        await atlasReconstruction.reject(userWith(UserPermissions.PeerReview, "rejector-1"), transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.Initialized);
        expect(atlasReconstruction.reviewerId).toBe("rejector-1");
    });

    test("records the reject event", async () => {
        const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        const atlasReconstruction = child(AtlasReconstructionStatus.FailedDoiAssignment);

        await atlasReconstruction.reject(userWith(UserPermissions.PublishReview), transaction);

        expect(create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.AtlasReconstructionReject, targetId: "atlas-1"});
    });
});
