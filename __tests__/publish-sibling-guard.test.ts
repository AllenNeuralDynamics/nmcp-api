import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, PublishedCandidateBlockingStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {Neuron} = require("../src/models/neuron");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SearchIndex} = require("../src/models/searchIndex");
const {EventLogItem} = require("../src/models/eventLogItem");

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

function siblingStub(status: number) {
    const sibling = Object.create(Reconstruction.prototype);
    sibling.id = `sibling-${status}`;
    sibling.neuronId = "neuron-1";
    sibling.status = status;
    sibling.update = updateMock(sibling);
    sibling.getAtlasReconstruction = vi.fn().mockResolvedValue({id: "atlas-old"});
    return sibling;
}

function publishable(siblings: any[], canonicalDoi: string | null = "10.x/canonical", doi: string | null = "10.x/abc") {
    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue(siblings);

    // Publish asserts the DOIs the assignment phase registered, reading the canonical off the locked neuron row.
    const lockNeuron = vi.spyOn(Neuron, "findByPk").mockResolvedValue({id: "neuron-1", canonicalDoi: canonicalDoi} as any);
    const destroySearchIndex = vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0);

    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.status = ReconstructionStatus.ReadyToPublish;
    reconstruction.update = updateMock(reconstruction);

    const atlasReconstruction = {nodeCounts: {}, doi: doi, tryStartPublishing: vi.fn().mockResolvedValue(true)};

    reconstruction.AtlasReconstruction = atlasReconstruction;

    // Both rows are re-read under lock inside the transaction now: the instances publish was handed were loaded before
    // it opened, and a reset, reject or discard can have moved the pair since.
    const lockChild = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any);
    const lockParent = vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);

    return {reconstruction, atlasReconstruction, findAll, lockNeuron, lockChild, lockParent, destroySearchIndex};
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("publishWithTransaction sibling guard", () => {
    test("proceeds when the neuron has no blocking sibling", async () => {
        const stubs = publishable([]);

        const published = await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction);

        expect(published.status).toBe(ReconstructionStatus.Publishing);
    });

    // PublishFailed is the same case stalled: the sibling's predecessor is already archived and de-indexed, and only
    // requestSearchIndexing finishes it, so a second publish may not displace it either.
    test.each([
        [ReconstructionStatus.Publishing, false],
        [ReconstructionStatus.Publishing, true],
        [ReconstructionStatus.PublishFailed, false],
        [ReconstructionStatus.PublishFailed, true]
    ])("refuses with code 1003 when a sibling is at %s (replaceExisting: %s)", async (siblingStatus: number, replaceExisting: boolean) => {
        const stubs = publishable([siblingStub(siblingStatus)]);

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), replaceExisting, transaction))
            .rejects.toMatchObject({extensions: {code: 1003}});

        expect(stubs.destroySearchIndex).not.toHaveBeenCalled();
        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.ReadyToPublish);
    });

    test("refuses with code 1001 when a published sibling exists and replaceExisting is not set", async () => {
        const stubs = publishable([siblingStub(ReconstructionStatus.Published)]);

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toMatchObject({extensions: {code: 1001}});

        expect(stubs.destroySearchIndex).not.toHaveBeenCalled();
    });

    test("archives the published sibling when replaceExisting is set", async () => {
        const existingPublished = siblingStub(ReconstructionStatus.Published);
        const stubs = publishable([existingPublished]);

        const published = await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), true, transaction);

        expect(existingPublished.status).toBe(ReconstructionStatus.Archived);
        expect(stubs.destroySearchIndex).toHaveBeenCalledTimes(1);
        expect(published.status).toBe(ReconstructionStatus.Publishing);
    });

    // A neuron can hold both, and the in-progress publish is the one that may not be displaced.
    test("with both siblings, 1003 wins and nothing is archived", async () => {
        const existingPublished = siblingStub(ReconstructionStatus.Published);
        const stubs = publishable([existingPublished, siblingStub(ReconstructionStatus.Publishing)]);

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), true, transaction))
            .rejects.toMatchObject({extensions: {code: 1003}});

        expect(existingPublished.status).toBe(ReconstructionStatus.Published);
        expect(stubs.destroySearchIndex).not.toHaveBeenCalled();
    });
});

// Publish makes no DataCite call now, so a reconstruction that never went through the DOI assignment phase has to be
// refused rather than published without an identifier.
describe("publishWithTransaction DOI assertion", () => {
    test("refuses a reconstruction whose child has no DOI", async () => {
        const stubs = publishable([], "10.x/canonical", null);

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toThrow("The reconstruction has no DOI assigned");

        expect(stubs.findAll).not.toHaveBeenCalled();
        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.ReadyToPublish);
    });

    test("refuses a reconstruction whose neuron has no canonical DOI", async () => {
        const stubs = publishable([], null, "10.x/abc");

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toThrow("The reconstruction has no DOI assigned");

        expect(stubs.findAll).not.toHaveBeenCalled();
        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.ReadyToPublish);
    });
});

describe("publishWithTransaction neuron lock", () => {
    test("locks the neuron row on the transaction before reading the siblings", async () => {
        const stubs = publishable([]);

        await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction);

        expect(stubs.lockNeuron).toHaveBeenCalledWith("neuron-1", {
            transaction: transaction,
            lock: Transaction.LOCK.UPDATE
        });

        expect(stubs.lockNeuron.mock.invocationCallOrder[0]).toBeLessThan(stubs.findAll.mock.invocationCallOrder[0]);
    });

    test("the sibling read is scoped to this neuron and the blocking statuses, on the transaction", async () => {
        const stubs = publishable([]);

        await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction);

        const options = stubs.findAll.mock.calls[0][0] as any;

        expect(options.where.neuronId).toBe("neuron-1");
        expect(options.where.status[Op.in]).toBe(PublishedCandidateBlockingStatuses);
        expect(options.transaction).toBe(transaction);
    });

    // Neuron, then the child, then the parent - the one global order.  The atlas upload takes the same three in the
    // same sequence, which is what keeps an upload and a stale publish from holding them against each other.
    test("locks Neuron, then the child, then the parent", async () => {
        const stubs = publishable([]);

        await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction);

        expect(stubs.lockChild).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        expect(stubs.lockParent).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

        expect(stubs.lockNeuron.mock.invocationCallOrder[0]).toBeLessThan(stubs.lockChild.mock.invocationCallOrder[0]);
        expect(stubs.lockChild.mock.invocationCallOrder[0]).toBeLessThan(stubs.lockParent.mock.invocationCallOrder[0]);
    });
});

/**
 * The publish-versus-reset interleaving.  A reset commits after publish loaded its instances; without the locked
 * re-read, publish would overwrite the replay it had already accepted and set the parent to Publishing with a child
 * back at the beginning of the pipeline.
 */
describe("publishWithTransaction against a committed reset", () => {
    test("refuses when the locked parent has left ReadyToPublish", async () => {
        const stubs = publishable([]);

        const locked = Object.assign(Object.create(Reconstruction.prototype), stubs.reconstruction, {
            status: ReconstructionStatus.WaitingForAtlasReconstruction
        });
        locked.update = updateMock(locked);

        stubs.lockParent.mockResolvedValue(locked);

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toThrow("The reconstruction is not in a publishable state");

        expect(stubs.atlasReconstruction.tryStartPublishing).not.toHaveBeenCalled();
        expect(locked.update).not.toHaveBeenCalled();
        expect(stubs.findAll).not.toHaveBeenCalled();
    });

    // The compare-and-set is the backstop for the case the locked reads cannot see: the child moved, the parent did
    // not, so only the conditional update can tell.
    test("refuses when the child has left ReadyToPublish, without writing the parent", async () => {
        const stubs = publishable([]);

        stubs.atlasReconstruction.tryStartPublishing = vi.fn().mockResolvedValue(false);

        await expect(stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), false, transaction))
            .rejects.toThrow("The associated atlas reconstruction is not in a publishable state");

        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.ReadyToPublish);
    });
});
