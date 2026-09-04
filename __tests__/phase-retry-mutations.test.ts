import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {QualityControl} = require("../src/models/qualityControl");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"} as any;

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

/**
 * One static per phase, all five built from requestPhaseRetry, so the table is the test: the same guards, the same
 * reset, the same event, differing only in the status pair being reversed.
 */
const phases = [
    {
        name: "requestQualityControlReassessment",
        call: (user: any, id: string) => AtlasReconstruction.requestQualityControlReassessment(user, id),
        failed: AtlasReconstructionStatus.FailedQualityControl,
        pending: AtlasReconstructionStatus.PendingQualityControl,
        kind: EventLogItemKind.AtlasReconstructionQualityControlRequest,
        message: "quality control reassessment"
    },
    {
        name: "requestDoiAssignment",
        call: (user: any, id: string) => AtlasReconstruction.requestDoiAssignment(user, id),
        failed: AtlasReconstructionStatus.FailedDoiAssignment,
        pending: AtlasReconstructionStatus.PendingDoiAssignment,
        kind: EventLogItemKind.AtlasReconstructionDoiAssignmentRequest,
        message: "DOI assignment"
    },
    {
        name: "requestStructureAssignment",
        call: (user: any, id: string) => AtlasReconstruction.requestStructureAssignment(user, id),
        failed: AtlasReconstructionStatus.FailedStructureAssignment,
        pending: AtlasReconstructionStatus.PendingStructureAssignment,
        kind: EventLogItemKind.AtlasReconstructionNodeStructureAssignmentRequest,
        message: "structure assignment"
    },
    {
        name: "requestPrecomputedRegeneration",
        call: (user: any, id: string) => AtlasReconstruction.requestPrecomputedRegeneration(user, id),
        failed: AtlasReconstructionStatus.FailedPrecomputed,
        pending: AtlasReconstructionStatus.PendingPrecomputed,
        kind: EventLogItemKind.AtlasReconstructionPrecomputedRequest,
        message: "precomputed regeneration"
    },
    {
        name: "requestSearchIndexing",
        call: (user: any, id: string) => AtlasReconstruction.requestSearchIndexing(user, id),
        failed: AtlasReconstructionStatus.FailedSearchIndexing,
        pending: AtlasReconstructionStatus.PendingSearchIndexing,
        kind: EventLogItemKind.AtlasReconstructionIndexingRequest,
        message: "search indexing"
    }
];

// Every status a child can hold, so each mutation is shown to admit exactly the one failure it reverses - the In...
// values included, because a claim is released by the worker or its sweep and never by hand.
const allStatuses: number[] = Object.values(AtlasReconstructionStatus).filter(value => typeof value === "number") as number[];

function requestable(status: number | null, options: {precomputed?: any, qualityControl?: any, parent?: any} = {}) {
    const transactionFn = vi.fn().mockImplementation(async (callback: any) => await callback(transaction));

    Object.defineProperty(AtlasReconstruction, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});

    const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

    const precomputed = "precomputed" in options
        ? options.precomputed
        : {requestGeneration: vi.fn().mockResolvedValue(undefined)};

    const qualityControl = "qualityControl" in options
        ? options.qualityControl
        : {makePending: vi.fn().mockResolvedValue(undefined)};

    vi.spyOn(QualityControl, "findOne").mockResolvedValue(qualityControl);

    // Only requestSearchIndexing reads it - its afterReset moves the parent back off PublishFailed - but every phase
    // runs through this fixture, so it is always stubbed.
    const parent = "parent" in options
        ? options.parent
        : (() => {
            const instance = Object.create(Reconstruction.prototype);

            Object.assign(instance, {id: "reconstruction-1", status: ReconstructionStatus.PublishFailed});

            instance.update = updateMock(instance);

            return instance;
        })();

    const lockParent = vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(parent);

    const child = status === null ? null : (() => {
        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: status,
            // Populated as a failed child would be, so the reset is shown to clear them.
            failureReason: "unexpected TypeError during structure assignment",
            failedAt: new Date("2026-03-01"),
            getPrecomputed: vi.fn().mockResolvedValue(precomputed)
        });

        instance.update = updateMock(instance);

        return instance;
    })();

    return {
        child: child,
        parent: parent,
        lockParent: lockParent,
        precomputed: precomputed,
        qualityControl: qualityControl,
        create: create,
        findOne: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(child)
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (AtlasReconstruction as any).sequelize;
    delete (QualityControl as any).sequelize;
});

describe.each(phases)("$name", (phase) => {
    test("refuses a peer reviewer and a user with no permissions, before any query", async () => {
        const stubs = requestable(phase.failed);

        await expect(phase.call(userWith(UserPermissions.PeerReview), "reconstruction-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        await expect(phase.call(userWith(UserPermissions.None), "reconstruction-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.findOne).not.toHaveBeenCalled();
    });

    // Restarting a phase is supervisory, so it follows resetPipeline rather than canModifyReconstruction: an admin
    // holding no review bit is the right person to have it, and the replay must not be more available than the retry.
    test("allows an admin who holds no review bit", async () => {
        const stubs = requestable(phase.failed);

        const child = await phase.call(userWith(UserPermissions.Admin), "reconstruction-1");

        expect(child.status).toBe(phase.pending);
        expect(stubs.findOne).toHaveBeenCalled();
    });

    test("throws when the reconstruction has no atlas child", async () => {
        requestable(null);

        await expect(phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow("No atlas reconstruction found for this reconstruction");
    });

    test("resets the status, clears the failure metadata and records the request", async () => {
        const stubs = requestable(phase.failed);

        const child = await phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(child.status).toBe(phase.pending);
        expect(child.failureReason).toBeNull();
        expect(child.failedAt).toBeNull();

        expect(stubs.child.update).toHaveBeenCalledWith(
            {status: phase.pending, failureReason: null, failedAt: null},
            {transaction: transaction}
        );

        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: phase.kind, targetId: "atlas-1"});
    });

    test("locks the atlas row inside the one transaction", async () => {
        const stubs = requestable(phase.failed);

        await phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.findOne).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });
    });

    // Typed, because the common case is benign - the phase completed a moment before the request - and a script caller
    // has to tell "nothing to retry" from a real failure without parsing prose.
    test.each(allStatuses.filter(status => status !== phase.failed))("refuses a child at %s with code 1004", async (status: number) => {
        const stubs = requestable(status);

        await expect(phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toMatchObject({
                message: `This reconstruction is not waiting on ${phase.message}; its current phase has already moved on.`,
                extensions: {code: 1004}
            });

        expect(stubs.child.update).not.toHaveBeenCalled();
    });
});

describe("requestPrecomputedRegeneration re-requests the generation", () => {
    // Without this the reset is inert: the precomputed service selects on Precomputed.status == Pending, which
    // updateGeneration left at FailedToLoad or FailedToGenerate.
    test("asks the precomputed row for a fresh generation on the same transaction", async () => {
        const stubs = requestable(AtlasReconstructionStatus.FailedPrecomputed);

        await AtlasReconstruction.requestPrecomputedRegeneration(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.child.getPrecomputed).toHaveBeenCalledWith({transaction: transaction});
        expect(stubs.precomputed.requestGeneration).toHaveBeenCalledWith(expect.anything(), transaction);
    });

    test("throws rather than resetting only the child when there is no precomputed row", async () => {
        requestable(AtlasReconstructionStatus.FailedPrecomputed, {precomputed: null});

        await expect(AtlasReconstruction.requestPrecomputedRegeneration(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow("No precomputed record found for this reconstruction");
    });

    // The other three have no afterReset hook, so nothing else may reach for the precomputed row.
    test.each(phases.filter(phase => phase.name !== "requestPrecomputedRegeneration"))(
        "$name does not touch the precomputed row",
        async (phase) => {
            const stubs = requestable(phase.failed);

            await phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1");

            expect(stubs.precomputed.requestGeneration).not.toHaveBeenCalled();
        }
    );
});

describe("requestQualityControlReassessment re-requests the check", () => {
    // Without this the reset is inert for the same reason the precomputed one is: the worker's QualityControl.getPending
    // selects on that row, not on the child, and assess left it at its failed result.
    test("makes the quality control row pending on the same transaction", async () => {
        const stubs = requestable(AtlasReconstructionStatus.FailedQualityControl);

        await AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(QualityControl.findOne).toHaveBeenCalledWith({where: {reconstructionId: "atlas-1"}, transaction: transaction});
        expect(stubs.qualityControl.makePending).toHaveBeenCalledWith(expect.anything(), transaction);
    });

    test("throws rather than resetting only the child when there is no quality control row", async () => {
        requestable(AtlasReconstructionStatus.FailedQualityControl, {qualityControl: null});

        await expect(AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow("No quality control record found for this reconstruction");
    });

    // The other four have no reason to reach for that row.
    test.each(phases.filter(phase => phase.name !== "requestQualityControlReassessment"))(
        "$name does not touch the quality control row",
        async (phase) => {
            const stubs = requestable(phase.failed);

            await phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1");

            expect(stubs.qualityControl.makePending).not.toHaveBeenCalled();
        }
    );
});

describe("requestSearchIndexing restores the parent", () => {
    // Without this the reset is inert in a different way to the other two: the child would index successfully, but
    // onAtlasReconstructionStatusChanged only moves a parent it finds at Publishing, so the reconstruction would end
    // with a Published child under a PublishFailed parent.
    test("moves the parent from PublishFailed back to Publishing on the same transaction", async () => {
        const stubs = requestable(AtlasReconstructionStatus.FailedSearchIndexing);

        await AtlasReconstruction.requestSearchIndexing(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.lockParent).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

        expect(stubs.parent.status).toBe(ReconstructionStatus.Publishing);
        expect(stubs.parent.update).toHaveBeenCalledWith({status: ReconstructionStatus.Publishing}, {transaction: transaction});

        // Child first, then parent - the one lock order.
        expect(stubs.child.update.mock.invocationCallOrder[0]).toBeLessThan(stubs.parent.update.mock.invocationCallOrder[0]);
    });

    // The guard is in resumePublishing, so a parent something else has moved since is logged and left alone rather
    // than dragged back into Publishing.  The child still resets, which is what the retry is for.
    test("leaves a parent at any other status alone, and still resets the child", async () => {
        const parent = Object.assign(Object.create(Reconstruction.prototype), {
            id: "reconstruction-1",
            status: ReconstructionStatus.Published
        });

        parent.update = updateMock(parent);

        requestable(AtlasReconstructionStatus.FailedSearchIndexing, {parent: parent});

        const child = await AtlasReconstruction.requestSearchIndexing(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(parent.status).toBe(ReconstructionStatus.Published);
        expect(parent.update).not.toHaveBeenCalled();
        expect(child.status).toBe(AtlasReconstructionStatus.PendingSearchIndexing);
    });

    test("throws rather than resetting only the child when there is no parent", async () => {
        requestable(AtlasReconstructionStatus.FailedSearchIndexing, {parent: null});

        await expect(AtlasReconstruction.requestSearchIndexing(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow("No reconstruction found for this atlas reconstruction");
    });

    // The other four have no reason to move the parent: their failures all leave it at WaitingForAtlasReconstruction.
    test.each(phases.filter(phase => phase.name !== "requestSearchIndexing"))(
        "$name leaves the parent where it is",
        async (phase) => {
            const stubs = requestable(phase.failed);

            await phase.call(userWith(UserPermissions.PublishReview), "reconstruction-1");

            expect(stubs.parent.update).not.toHaveBeenCalled();
        }
    );
});

/**
 * The pipeline-entry paths, which have no retry mutation of their own but rewind the child all the same.  A failure
 * recorded on a previous run does not describe the run that follows it.
 */
describe("prepareToFinalize and replaceNodeData clear the failure metadata", () => {
    function entering(status: number) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: status,
            nodeCounts: {axon: {}, dendrite: {}},
            failureReason: "unexpected TypeError during structure assignment",
            failedAt: new Date("2026-03-01"),
            getPrecomputed: vi.fn().mockResolvedValue({})
        });

        instance.update = updateMock(instance);

        return instance;
    }

    test("prepareToFinalize resets to pending quality control with the columns cleared", async () => {
        const atlasReconstruction = entering(AtlasReconstructionStatus.FailedQualityControl);

        vi.spyOn(QualityControl, "findOne").mockResolvedValue({makePending: vi.fn().mockResolvedValue(undefined)} as any);

        const {Precomputed} = require("../src/models/precomputed");
        vi.spyOn(Precomputed, "findOne").mockResolvedValue({} as any);

        await atlasReconstruction.prepareToFinalize(userWith(UserPermissions.PublishReview), transaction);

        expect(atlasReconstruction.update).toHaveBeenCalledWith(
            {status: AtlasReconstructionStatus.PendingQualityControl, failureReason: null, failedAt: null},
            {transaction: transaction}
        );

        expect(atlasReconstruction.failureReason).toBeNull();
        expect(atlasReconstruction.failedAt).toBeNull();
    });

    test("replaceNodeData clears them along with the new data", async () => {
        const atlasReconstruction = entering(AtlasReconstructionStatus.FailedStructureAssignment);

        const {AtlasNode} = require("../src/models/atlasNode");
        const {Atlas} = require("../src/models/atlas");

        // mapToAtlasNodeShape reads the default atlas to resolve a manually assigned structure.
        Object.defineProperty(Atlas, "defaultAtlas", {
            value: {getFromStructureId: () => null},
            configurable: true,
            writable: true
        });

        vi.spyOn(AtlasNode, "destroy").mockResolvedValue(0 as any);
        vi.spyOn(AtlasNode, "bulkCreate").mockResolvedValue([] as any);
        vi.spyOn(AtlasNode, "create").mockResolvedValue({id: "soma-1"} as any);

        const structure = {
            getNonSomaNodes: () => [],
            NeuronStructureId: "neuron-structure-1",
            nodeCounts: {},
            soma: {x: 0, y: 0, z: 0, radius: 1, index: 1, parentIndex: -1}
        };

        await atlasReconstruction.replaceNodeData(
            userWith(UserPermissions.PublishReview),
            {source: "s", comments: "c", axon: structure, dendrite: structure},
            transaction
        );

        expect(atlasReconstruction.failureReason).toBeNull();
        expect(atlasReconstruction.failedAt).toBeNull();
        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.ReadyToProcess);
    });
});
