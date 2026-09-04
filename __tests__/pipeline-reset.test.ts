import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus, AbandonableFailureStatuses} = require("../src/models/atlasReconstructionStatus");
const {QualityControl} = require("../src/models/qualityControl");
const {Precomputed} = require("../src/models/precomputed");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"} as any;

const resettable = [...AbandonableFailureStatuses, AtlasReconstructionStatus.ReadyToPublish] as number[];

const allStatuses: number[] = Object.values(AtlasReconstructionStatus).filter(value => typeof value === "number") as number[];

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function updateMock(instance: any) {
    return vi.fn().mockImplementation(async (update: any) => {
        Object.assign(instance, update);
        return instance;
    });
}

function stub(childStatus: number | null, parentStatus: number = ReconstructionStatus.WaitingForAtlasReconstruction) {
    const transactionFn = vi.fn().mockImplementation(async (callback: any) => await callback(transaction));

    Object.defineProperty(AtlasReconstruction, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});

    const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

    const qualityControl = {makePending: vi.fn().mockResolvedValue(undefined)};
    const precomputed = {id: "precomputed-1", status: "untouched"};

    vi.spyOn(QualityControl, "findOne").mockResolvedValue(qualityControl as any);
    vi.spyOn(QualityControl, "createForReconstruction").mockResolvedValue({id: "qc-new"} as any);
    const createPrecomputed = vi.spyOn(Precomputed, "createForReconstruction").mockResolvedValue(precomputed as any);
    vi.spyOn(Precomputed, "findOne").mockResolvedValue(precomputed as any);

    const child = childStatus === null ? null : (() => {
        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: childStatus,
            doi: "10.60533/nmcp-1",
            nodeCounts: {axon: {}, dendrite: {}},
            failureReason: "unexpected TypeError during structure assignment",
            failedAt: new Date("2026-03-01"),
            nodeStructureAssignmentAt: new Date("2026-03-01")
        });

        instance.update = updateMock(instance);

        return instance;
    })();

    const parent = Object.create(Reconstruction.prototype);

    Object.assign(parent, {id: "reconstruction-1", neuronId: "neuron-1", status: parentStatus});

    parent.update = updateMock(parent);

    return {
        child: child,
        parent: parent,
        qualityControl: qualityControl,
        precomputed: precomputed,
        create: create,
        createPrecomputed: createPrecomputed,
        findChild: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(child),
        findParent: vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(parent)
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (AtlasReconstruction as any).sequelize;
});

describe("resetPipeline authorization", () => {
    test.each([
        ["a peer reviewer", UserPermissions.PeerReview],
        ["an annotator", UserPermissions.AnnotateOne],
        ["a user with no permissions", UserPermissions.None]
    ])("refuses %s, before any query", async (_label: string, permissions: number) => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        await expect(AtlasReconstruction.resetPipeline(userWith(permissions), "reconstruction-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.findChild).not.toHaveBeenCalled();
    });

    // A replay is a supervisory action on a reconstruction that is stuck, so an admin holding no review bit has it -
    // and so, for the same reason, does a publish reviewer who is not an admin.
    test.each([
        ["an admin holding no review bit", UserPermissions.Admin],
        ["a publish reviewer", UserPermissions.PublishReview]
    ])("allows %s", async (_label: string, permissions: number) => {
        const stubs = stub(AtlasReconstructionStatus.FailedPrecomputed);

        const child = await AtlasReconstruction.resetPipeline(userWith(permissions), "reconstruction-1");

        expect(child.status).toBe(AtlasReconstructionStatus.PendingQualityControl);
        expect(stubs.findChild).toHaveBeenCalled();
    });
});

describe("resetPipeline admissible statuses", () => {
    test.each(resettable)("accepts a child at %s", async (status: number) => {
        const stubs = stub(status);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingQualityControl);
    });

    /**
     * Typed with the reset's own message rather than requestPhaseRetry's, which names a single phase and has no meaning
     * for a replay.  FailedSearchIndexing and the In... claims are in here deliberately: indexing failures are a
     * problem with that process, and a claim is released by the worker or its sweep and never by hand.
     */
    test.each(allStatuses.filter(status => !resettable.includes(status)))(
        "refuses a child at %s with code 1004 and writes nothing",
        async (status: number) => {
            const stubs = stub(status);

            await expect(AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1"))
                .rejects.toMatchObject({
                    message: `The automatic phases cannot be replayed for a reconstruction at ${AtlasReconstructionStatus[status]}; they are only replayable from a failed phase or from ReadyToPublish.`,
                    extensions: {code: 1004}
                });

            expect(stubs.child.update).not.toHaveBeenCalled();
            expect(stubs.parent.update).not.toHaveBeenCalled();
            expect(stubs.qualityControl.makePending).not.toHaveBeenCalled();
        });

    test("throws when the reconstruction has no atlas child", async () => {
        stub(null);

        await expect(AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow("No atlas reconstruction found for this reconstruction");
    });
});

describe("resetPipeline effect", () => {
    test("re-enters the pipeline with the failure metadata and the structure assignment stamp cleared", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedDoiAssignment);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingQualityControl);
        expect(stubs.child.failureReason).toBeNull();
        expect(stubs.child.failedAt).toBeNull();
        expect(stubs.child.nodeStructureAssignmentAt).toBeNull();
    });

    test("puts the quality control row back to Pending, which is what the worker selects on", async () => {
        const stubs = stub(AtlasReconstructionStatus.ReadyToPublish);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.qualityControl.makePending).toHaveBeenCalledWith(expect.anything(), transaction);
    });

    // Persistent results are kept: a replay is safe to run on a reconstruction that already holds a DOI, and
    // assignDoisWithinPhase recognises an identifier it has already registered.
    test("keeps the DOI", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedDoiAssignment);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.child.doi).toBe("10.60533/nmcp-1");
    });

    // prepareToFinalize deliberately leaves the Precomputed row alone - structure assignment is what puts it back to
    // Pending on the next run through - so nothing here should "helpfully" reset it either.
    test("leaves an existing precomputed row untouched", async () => {
        const stubs = stub(AtlasReconstructionStatus.ReadyToPublish);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.precomputed.status).toBe("untouched");
        expect(stubs.createPrecomputed).not.toHaveBeenCalled();
    });

    test("records the replay under its own event kind", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedStructureAssignment);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        const kinds = stubs.create.mock.calls.map((call: any) => call[0].kind);

        expect(kinds).toContain(EventLogItemKind.AtlasReconstructionPipelineReset);
    });
});

describe("resetPipeline and the parent", () => {
    // From ReadyToPublish the reconstruction leaves the publisher's queue rather than sitting there advertising a
    // pipeline that is running.
    test("returns a ReadyToPublish parent to WaitingForAtlasReconstruction", async () => {
        const stubs = stub(AtlasReconstructionStatus.ReadyToPublish, ReconstructionStatus.ReadyToPublish);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.parent.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
    });

    test.each(AbandonableFailureStatuses as number[])("leaves the parent alone for a child at %s", async (status: number) => {
        const stubs = stub(status, ReconstructionStatus.WaitingForAtlasReconstruction);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.parent.update).not.toHaveBeenCalled();
    });
});

describe("resetPipeline serialization", () => {
    test("locks the child, then the parent, inside the one transaction", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.findChild).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        expect(stubs.findParent).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

        expect(stubs.findChild.mock.invocationCallOrder[0]).toBeLessThan(stubs.findParent.mock.invocationCallOrder[0]);
    });
});
