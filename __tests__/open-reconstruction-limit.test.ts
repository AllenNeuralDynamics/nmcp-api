import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one openReconstruction calls into, so the spies would not apply.
const {Op, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, ClosedReconstructionStatuses} = require("../src/models/reconstruction");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");

// A non-null transaction argument keeps ownTransaction false, so the method never touches
// Reconstruction.sequelize (absent because the model is never initialized here).
const transaction = {} as any;

function annotator(permissions: number) {
    const user = Object.create(User.prototype);
    user.id = "annotator-1";
    user.permissions = permissions;
    return user;
}

type Stubs = {
    findUserOrId: any;
    findByPk: any;
    findOne: any;
    count: any;
    createWithTransaction: any;
    createForShape: any;
};

function stub(user: any, options: { existing?: any, openCount?: number } = {}): Stubs {
    const created = {id: "reconstruction-1"};

    return {
        findUserOrId: vi.spyOn(User, "findUserOrId").mockResolvedValue(user),
        findByPk: vi.spyOn(User, "findByPk").mockResolvedValue(user),
        findOne: vi.spyOn(Reconstruction, "findOne").mockResolvedValue(options.existing ?? null),
        count: vi.spyOn(Reconstruction, "count").mockResolvedValue(options.openCount ?? 0),
        createWithTransaction: vi.spyOn(Reconstruction as any, "createWithTransaction").mockResolvedValue(created),
        createForShape: vi.spyOn(AtlasReconstruction, "createForShape").mockResolvedValue({id: "atlas-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("openReconstruction with a supplied transaction", () => {
    test("creates for a limited user with nothing open", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        const [reconstruction, isExisting] = await Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction);

        expect(isExisting).toBe(false);
        expect(reconstruction.id).toBe("reconstruction-1");
        expect(stubs.createWithTransaction).toHaveBeenCalledTimes(1);
    });

    test("refuses a limited user who already has one open elsewhere", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 1});

        await expect(Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction)).rejects.toMatchObject({
            extensions: {code: 1002}
        });

        expect(stubs.createWithTransaction).not.toHaveBeenCalled();
    });

    test("returns the limited user's existing reconstruction on the same neuron without counting", async () => {
        const existing = {id: "existing-1"};
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: existing});

        const [reconstruction, isExisting] = await Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction);

        expect(isExisting).toBe(true);
        expect(reconstruction).toBe(existing);
        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.createWithTransaction).not.toHaveBeenCalled();
    });

    test("does not limit an AnnotateMany user with something open", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateMany), {existing: null, openCount: 1});

        const [, isExisting] = await Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction);

        expect(isExisting).toBe(false);
        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.findByPk).not.toHaveBeenCalled();
        expect(stubs.createWithTransaction).toHaveBeenCalledTimes(1);
    });

    test("does not limit when enforceAnnotationLimit is false", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 1});

        const [, isExisting] = await Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction, null, false);

        expect(isExisting).toBe(false);
        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.findByPk).not.toHaveBeenCalled();
        expect(stubs.createWithTransaction).toHaveBeenCalledTimes(1);
    });

    test("counts the annotator's non-closed reconstructions on the transaction", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        await Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction);

        const options = stubs.count.mock.calls[0][0];

        expect(options.where.annotatorId).toBe("annotator-1");
        expect(options.where.status[Op.notIn]).toBe(ClosedReconstructionStatuses);
        expect(options.transaction).toBe(transaction);
    });

    test("locks the annotator's row on the transaction before reading", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        await Reconstruction.openReconstruction("neuron-1", "annotator-1", transaction);

        expect(stubs.findByPk).toHaveBeenCalledWith("annotator-1", {
            transaction: transaction,
            lock: Transaction.LOCK.UPDATE
        });

        expect(stubs.findByPk.mock.invocationCallOrder[0]).toBeLessThan(stubs.findOne.mock.invocationCallOrder[0]);
        expect(stubs.findByPk.mock.invocationCallOrder[0]).toBeLessThan(stubs.count.mock.invocationCallOrder[0]);
    });
});

describe("openReconstruction with a self-owned transaction", () => {
    // Model.sequelize is a plain static assigned during init(), which never runs here, and TypeScript declares
    // it readonly -- so define the property rather than assigning it.
    function stubTransactionFactory() {
        const commit = vi.fn();
        const rollback = vi.fn();

        Object.defineProperty(Reconstruction, "sequelize", {
            value: {transaction: vi.fn().mockResolvedValue({commit, rollback})},
            configurable: true,
            writable: true
        });

        return {commit, rollback};
    }

    test("commits when resuming an existing reconstruction on the same neuron", async () => {
        stub(annotator(UserPermissions.AnnotateOne), {existing: {id: "existing-1"}});
        const {commit, rollback} = stubTransactionFactory();

        const [, isExisting] = await Reconstruction.openReconstruction("neuron-1", "annotator-1");

        expect(isExisting).toBe(true);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(rollback).not.toHaveBeenCalled();
    });

    test("commits on the create path", async () => {
        stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});
        const {commit, rollback} = stubTransactionFactory();

        const [, isExisting] = await Reconstruction.openReconstruction("neuron-1", "annotator-1");

        expect(isExisting).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(rollback).not.toHaveBeenCalled();
    });

    test("rolls back, releasing the lock, when the limit refuses", async () => {
        stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 1});
        const {commit, rollback} = stubTransactionFactory();

        await expect(Reconstruction.openReconstruction("neuron-1", "annotator-1")).rejects.toMatchObject({
            extensions: {code: 1002}
        });

        expect(rollback).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
    });
});
