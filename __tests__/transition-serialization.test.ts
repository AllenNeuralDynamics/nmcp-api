import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {Neuron} = require("../src/models/neuron");
const {SpecimenNode} = require("../src/models/specimenNode");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {SearchIndex} = require("../src/models/searchIndex");
const {EventLogItem} = require("../src/models/eventLogItem");
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

// A minimal SimpleReconstruction stand-in.  Both replaceNodeData implementations need a soma and two structures.
function reconstructionData() {
    const soma = {index: 1, parentIndex: -1, structure: 1, x: 1, y: 2, z: 3, radius: 1, lengthToParent: 0};

    const structure = (neuronStructureId: string) => ({
        soma: soma,
        NeuronStructureId: neuronStructureId,
        nodeCounts: {total: 1, soma: 1, path: 0, branch: 0, end: 0},
        getNonSomaNodes: () => []
    });

    return {source: "test.swc", comments: "", axon: structure("ns-axon"), dendrite: structure("ns-dendrite")};
}

function parentStub(status: number, extra: object = {}) {
    const reconstruction = Object.create(Reconstruction.prototype);

    Object.assign(reconstruction, {
        id: "reconstruction-1",
        neuronId: "neuron-1",
        annotatorId: "annotator-1",
        status: status
    }, extra);

    reconstruction.update = updateMock(reconstruction);
    reconstruction.destroy = vi.fn();

    return reconstruction;
}

function childStub(status: number, extra: object = {}) {
    const child = Object.create(AtlasReconstruction.prototype);

    Object.assign(child, {
        id: "atlas-1",
        reconstructionId: "reconstruction-1",
        status: status,
        doi: "10.60533/nmcp-1",
        nodeCounts: {axon: {}, dendrite: {}}
    }, extra);

    child.update = updateMock(child);
    child.replaceNodeData = vi.fn().mockResolvedValue(undefined);
    child.reject = vi.fn().mockResolvedValue(undefined);
    child.approve = vi.fn().mockResolvedValue(undefined);
    child.tryStartPublishing = vi.fn().mockResolvedValue(true);
    child.getSoma = vi.fn().mockResolvedValue({x: 4, y: 5, z: 6});

    return child;
}

/**
 * Each case stubs the locked read to return a row whose status differs from the eager one, standing in for a commit
 * that landed between the two.  eagerParent is what findReconstructionAndUser handed the caller; lockedParent is what
 * the row actually holds by the time the transaction takes it FOR UPDATE.
 */
function interleaved(options: {
    eagerParent: number;
    lockedParent?: number;
    eagerChild?: number;
    lockedChild?: number;
    user: any;
}) {
    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction))},
        configurable: true,
        writable: true
    });

    Object.defineProperty(AtlasReconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction))},
        configurable: true,
        writable: true
    });

    const eagerChild = childStub(options.eagerChild ?? AtlasReconstructionStatus.ReadyToPublish);
    const lockedChild = childStub(options.lockedChild ?? options.eagerChild ?? AtlasReconstructionStatus.ReadyToPublish);

    const eager = parentStub(options.eagerParent, {AtlasReconstruction: eagerChild});
    const locked = parentStub(options.lockedParent ?? options.eagerParent);

    vi.spyOn(User, "findUserOrId").mockResolvedValue(options.user);

    // The lock option is what tells the two reads apart: without it this is the caller's eager load.
    const findParent = vi.spyOn(Reconstruction, "findByPk").mockImplementation(async (...args: any[]) =>
        args[1]?.lock ? locked : eager);

    const findChild = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(lockedChild);

    vi.spyOn(Neuron, "findByPk").mockResolvedValue({id: "neuron-1", canonicalDoi: "10.60533/canonical", atlasSoma: {x: 1, y: 2, z: 3}, update: vi.fn()} as any);

    return {eager: eager, locked: locked, eagerChild: eagerChild, lockedChild: lockedChild, findParent: findParent, findChild: findChild};
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
    delete (AtlasReconstruction as any).sequelize;
});

/**
 * Admissibility lost between the reads.  In each of these the caller's eager instance says the transition is allowed
 * and the row itself says otherwise.
 */
describe("admissibility lost between the reads", () => {
    // A retry commits, restarting the phase.  Rewinding the child now would have the worker complete its phase over the
    // rewind and run a rejected reconstruction on to DOI assignment.
    test("retry versus reject", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.WaitingForAtlasReconstruction,
            eagerChild: AtlasReconstructionStatus.FailedStructureAssignment,
            lockedChild: AtlasReconstructionStatus.PendingStructureAssignment,
            user: userWith(UserPermissions.PublishReview)
        });

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.lockedChild.reject).not.toHaveBeenCalled();
        expect(stubs.locked.update).not.toHaveBeenCalled();
    });

    test("retry versus discard", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.WaitingForAtlasReconstruction,
            eagerChild: AtlasReconstructionStatus.FailedStructureAssignment,
            lockedChild: AtlasReconstructionStatus.PendingStructureAssignment,
            user: userWith(UserPermissions.PublishReview)
        });

        const discardForReconstruction = vi.spyOn(AtlasReconstruction, "discardForReconstruction").mockResolvedValue(undefined);

        await expect(Reconstruction.discardReconstruction("reconstruction-1", "user-1"))
            .rejects.toThrow(/Cannot discard a reconstruction/);

        expect(discardForReconstruction).not.toHaveBeenCalled();
        expect(stubs.locked.destroy).not.toHaveBeenCalled();
    });

    // A reset commits and the replay is under way.  A stale ReadyToPublish would overwrite PendingQualityControl with
    // PendingSearchIndexing and set the parent to Publishing, so the replay would silently not happen.
    test("reset versus publish", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.ReadyToPublish,
            lockedParent: ReconstructionStatus.WaitingForAtlasReconstruction,
            eagerChild: AtlasReconstructionStatus.ReadyToPublish,
            lockedChild: AtlasReconstructionStatus.PendingQualityControl,
            user: userWith(UserPermissions.Admin)
        });

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await expect(stubs.eager.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toThrow("The reconstruction is not in a publishable state");

        expect(stubs.lockedChild.status).toBe(AtlasReconstructionStatus.PendingQualityControl);
        expect(stubs.lockedChild.tryStartPublishing).not.toHaveBeenCalled();
        expect(stubs.locked.update).not.toHaveBeenCalled();
        expect(findAll).not.toHaveBeenCalled();
    });

    test("reject versus publish", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.ReadyToPublish,
            lockedParent: ReconstructionStatus.Rejected,
            user: userWith(UserPermissions.Admin)
        });

        vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0);

        await expect(stubs.eager.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toThrow("The reconstruction is not in a publishable state");

        expect(stubs.locked.update).not.toHaveBeenCalled();
        expect(stubs.lockedChild.tryStartPublishing).not.toHaveBeenCalled();
    });

    test("reject versus approval", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PublishReview,
            lockedParent: ReconstructionStatus.Rejected,
            eagerChild: AtlasReconstructionStatus.ReadyToProcess,
            user: userWith(UserPermissions.Admin)
        });

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1"))
            .rejects.toThrow(/Cannot approve a reconstruction/);

        expect(stubs.locked.update).not.toHaveBeenCalled();
        expect(stubs.lockedChild.approve).not.toHaveBeenCalled();
    });

    // The import is not exempt from this one.  disregardAuth buys it out of the permission, never out of the state
    // rule: approving over a rejection that committed in between would silently reverse the reviewer.
    test("reject versus import approval", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PublishReview,
            lockedParent: ReconstructionStatus.Rejected,
            eagerChild: AtlasReconstructionStatus.ReadyToProcess,
            user: userWith(UserPermissions.None, "importer-1")
        });

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "importer-1", null, true))
            .rejects.toThrow(/Cannot approve a reconstruction/);

        expect(stubs.locked.update).not.toHaveBeenCalled();
        expect(stubs.lockedChild.approve).not.toHaveBeenCalled();
        expect((EventLogItem.create as any)).not.toHaveBeenCalled();
    });

    /**
     * The stall case, and the reason the atlas upload had to narrow to PublishReview rather than merely re-read.  An
     * upload that proceeded here would write the child back to ReadyToProcess while the parent sat at
     * WaitingForAtlasReconstruction - a child in no queue at all, which not even the new abandonment routes could
     * rescue, since ReadyToProcess is not an abandonable failure.
     */
    test("approval versus atlas upload", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PublishReview,
            lockedParent: ReconstructionStatus.WaitingForAtlasReconstruction,
            lockedChild: AtlasReconstructionStatus.PendingQualityControl,
            user: userWith(UserPermissions.PublishReview)
        });

        await expect(stubs.eager.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData()))
            .rejects.toThrow(/not in team or publish review/);

        expect(stubs.lockedChild.replaceNodeData).not.toHaveBeenCalled();
        expect(stubs.lockedChild.status).toBe(AtlasReconstructionStatus.PendingQualityControl);
    });

    // The child is untouched here, so there is no stall - but the approved record would no longer match what was
    // approved.
    test("approval versus specimen upload", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PublishReview,
            lockedParent: ReconstructionStatus.WaitingForAtlasReconstruction,
            user: userWith(UserPermissions.PublishReview)
        });

        const replaceNodeData = vi.spyOn(Reconstruction.prototype as any, "replaceNodeData").mockResolvedValue(undefined);
        const findPrecomputed = vi.spyOn(SpecimenSpacePrecomputed, "findOne")
            .mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)} as any);

        await expect(stubs.eager.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Specimen, reconstructionData()))
            .rejects.toThrow(/not in peer, team or publish review/);

        expect(replaceNodeData).not.toHaveBeenCalled();
        expect(findPrecomputed).not.toHaveBeenCalled();
    });
});

/**
 * Still admissible, but by a different actor.  Which actor may act depends on the status, so a status-only re-check
 * would let all of these through.
 */
describe("the actor changes with the status", () => {
    test("peer approval versus peer-reviewer reject", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PeerReview,
            lockedParent: ReconstructionStatus.PublishReview,
            user: userWith(UserPermissions.PeerReview)
        });

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.locked.update).not.toHaveBeenCalled();
        expect(stubs.lockedChild.reject).not.toHaveBeenCalled();
    });

    test("requestReview versus annotator discard", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.Rejected,
            lockedParent: ReconstructionStatus.PublishReview,
            user: userWith(UserPermissions.AnnotateOne, "annotator-1")
        });

        const discardForReconstruction = vi.spyOn(AtlasReconstruction, "discardForReconstruction").mockResolvedValue(undefined);
        vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0);

        await expect(Reconstruction.discardReconstruction("reconstruction-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(discardForReconstruction).not.toHaveBeenCalled();
        expect(stubs.locked.update).not.toHaveBeenCalled();
    });

    // PublishReview is a valid specimen-upload status, just not for this caller: the review the reconstruction is
    // actually in is who may rewrite its nodes.
    test("peer approval versus peer-reviewer specimen upload", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PeerReview,
            lockedParent: ReconstructionStatus.PublishReview,
            user: userWith(UserPermissions.PeerReview)
        });

        const replaceNodeData = vi.spyOn(Reconstruction.prototype as any, "replaceNodeData").mockResolvedValue(undefined);

        await expect(stubs.eager.fromParsedStructures(userWith(UserPermissions.PeerReview), ReconstructionSpace.Specimen, reconstructionData()))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(replaceNodeData).not.toHaveBeenCalled();
    });

    test("the same upload under disregardAuth succeeds, so the import path is unaffected", async () => {
        const stubs = interleaved({
            eagerParent: ReconstructionStatus.PeerReview,
            lockedParent: ReconstructionStatus.PublishReview,
            user: userWith(UserPermissions.None, "importer-1")
        });

        const replaceNodeData = vi.spyOn(Reconstruction.prototype as any, "replaceNodeData").mockResolvedValue(undefined);
        vi.spyOn(SpecimenSpacePrecomputed, "findOne")
            .mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)} as any);

        await stubs.eager.fromParsedStructures(userWith(UserPermissions.None, "importer-1"), ReconstructionSpace.Specimen, reconstructionData(), null, true);

        expect(replaceNodeData).toHaveBeenCalledTimes(1);
    });
});

/**
 * One global order: Neuron -> AtlasReconstruction -> Reconstruction.  Every path that changes the pair takes the child
 * before the parent, and the two paths that write a neuron take it before either.
 */
describe("lock order", () => {
    function ordered(parentStatus: number, childStatus: number, user: any) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        Object.defineProperty(Reconstruction, "sequelize", {
            value: {transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction))},
            configurable: true,
            writable: true
        });

        Object.defineProperty(AtlasReconstruction, "sequelize", {
            value: {transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction))},
            configurable: true,
            writable: true
        });

        const callOrder: string[] = [];

        const child = childStub(childStatus);
        const parent = parentStub(parentStatus, {AtlasReconstruction: child});

        vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

        vi.spyOn(Neuron, "findByPk").mockImplementation(async () => {
            callOrder.push("neuron");
            return {id: "neuron-1", canonicalDoi: "10.60533/canonical", atlasSoma: {x: 1, y: 2, z: 3}, update: vi.fn()} as any;
        });

        vi.spyOn(AtlasReconstruction, "findOne").mockImplementation(async () => {
            callOrder.push("child");
            return child;
        });

        vi.spyOn(Reconstruction, "findByPk").mockImplementation(async (...args: any[]) => {
            if (args[1]?.lock) {
                callOrder.push("parent");
            }

            return parent;
        });

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        return {parent: parent, child: child, callOrder: callOrder};
    }

    test("approve takes the child before the parent", async () => {
        const stubs = ordered(ReconstructionStatus.PublishReview, AtlasReconstructionStatus.ReadyToProcess, userWith(UserPermissions.Admin));

        await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1");

        expect(stubs.callOrder).toEqual(["child", "parent"]);
    });

    test("reject takes the child before the parent", async () => {
        const stubs = ordered(ReconstructionStatus.PublishReview, AtlasReconstructionStatus.ReadyToPublish, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.callOrder).toEqual(["child", "parent"]);
    });

    test("discard takes the child before the parent", async () => {
        const stubs = ordered(ReconstructionStatus.PublishReview, AtlasReconstructionStatus.ReadyToPublish, userWith(UserPermissions.Admin));

        vi.spyOn(AtlasReconstruction, "discardForReconstruction").mockResolvedValue(undefined);
        vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0);

        await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(stubs.callOrder).toEqual(["child", "parent"]);
    });

    test("the reset takes the child before the parent", async () => {
        const stubs = ordered(ReconstructionStatus.ReadyToPublish, AtlasReconstructionStatus.ReadyToPublish, userWith(UserPermissions.Admin));

        const {QualityControl} = require("../src/models/qualityControl");
        const {Precomputed} = require("../src/models/precomputed");

        vi.spyOn(QualityControl, "findOne").mockResolvedValue({makePending: vi.fn().mockResolvedValue(undefined)} as any);
        vi.spyOn(Precomputed, "findOne").mockResolvedValue({id: "precomputed-1"} as any);

        await AtlasReconstruction.resetPipeline(userWith(UserPermissions.Admin), "reconstruction-1");

        expect(stubs.callOrder).toEqual(["child", "parent"]);
    });

    // The two paths that write a Neuron.  Taking that row last in the upload is the inversion that deadlocks against a
    // publish holding the neuron and waiting on the child.
    test("publish takes the neuron, then the child, then the parent", async () => {
        const stubs = ordered(ReconstructionStatus.ReadyToPublish, AtlasReconstructionStatus.ReadyToPublish, userWith(UserPermissions.Admin));

        await stubs.parent.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction);

        expect(stubs.callOrder).toEqual(["neuron", "child", "parent"]);
    });

    test("the atlas upload takes them in that same order", async () => {
        const stubs = ordered(ReconstructionStatus.PublishReview, AtlasReconstructionStatus.ReadyToProcess, userWith(UserPermissions.PublishReview));

        await stubs.parent.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.callOrder).toEqual(["neuron", "child", "parent"]);
    });

    // The specimen branch writes no neuron and does not touch the child, so it locks the parent alone and cannot be
    // part of a cycle either way.
    test("the specimen upload takes the parent alone", async () => {
        const stubs = ordered(ReconstructionStatus.PublishReview, AtlasReconstructionStatus.ReadyToProcess, userWith(UserPermissions.PublishReview));

        vi.spyOn(Reconstruction.prototype as any, "replaceNodeData").mockResolvedValue(undefined);
        vi.spyOn(SpecimenSpacePrecomputed, "findOne")
            .mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)} as any);

        await stubs.parent.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Specimen, reconstructionData());

        expect(stubs.callOrder).toEqual(["parent"]);
    });
});
