import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, PublishedCandidateBlockingStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {Neuron} = require("../src/models/neuron");
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

function publishable(siblings: any[]) {
    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    // assignDoi makes live DataCite calls, which are not what this file is about.
    vi.spyOn(Reconstruction.prototype as any, "assignDoi").mockResolvedValue(undefined);

    const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue(siblings);
    const lockNeuron = vi.spyOn(Neuron, "findByPk").mockResolvedValue({id: "neuron-1"} as any);
    const destroySearchIndex = vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0);

    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.status = ReconstructionStatus.ReadyToPublish;
    reconstruction.update = updateMock(reconstruction);
    reconstruction.AtlasReconstruction = {nodeCounts: {}, tryStartPublishing: vi.fn().mockResolvedValue(true)};

    return {reconstruction, findAll, lockNeuron, destroySearchIndex};
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

    test.each([false, true])("refuses with code 1003 when a sibling is mid-publish (replaceExisting: %s)", async (replaceExisting: boolean) => {
        const midPublish = siblingStub(ReconstructionStatus.Publishing);
        const stubs = publishable([midPublish]);

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
});
