import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one openAnnotation calls into, so the spies would not apply.
const {Op, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation, AnnotationLimitExemptStatuses} = require("../src/models/annotation");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {SpecimenSpaceReconstructionStatus} = require("../src/models/specimenSpaceReconstructionStatus");

// A non-null transaction argument keeps ownTransaction false, so the method never touches
// Annotation.sequelize (absent because the model is never initialized here).
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
    createSpecimenSpace: any;
};

function stub(user: any, options: { existing?: any, openCount?: number } = {}): Stubs {
    const created = {id: "annotation-1"};

    return {
        findUserOrId: vi.spyOn(User, "findUserOrId").mockResolvedValue(user),
        findByPk: vi.spyOn(User, "findByPk").mockResolvedValue(user),
        findOne: vi.spyOn(Annotation, "findOne").mockResolvedValue(options.existing ?? null),
        count: vi.spyOn(Annotation, "count").mockResolvedValue(options.openCount ?? 0),
        createWithTransaction: vi.spyOn(Annotation as any, "createWithTransaction").mockResolvedValue(created),
        createForShape: vi.spyOn(AtlasReconstruction, "createForShape").mockResolvedValue({id: "atlas-1"}),
        createSpecimenSpace: vi.spyOn(SpecimenSpaceReconstruction, "createForShape").mockResolvedValue({id: "specimen-space-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Annotation as any).sequelize;
});

describe("openAnnotation with a supplied transaction", () => {
    test("creates for a limited user with nothing open", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        const [reconstruction, isExisting] = await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        expect(isExisting).toBe(false);
        expect(reconstruction.id).toBe("annotation-1");
        expect(stubs.createWithTransaction).toHaveBeenCalledTimes(1);
    });

    test("refuses a limited user who already has one open elsewhere", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 1});

        await expect(Annotation.openAnnotation("neuron-1", "annotator-1", transaction)).rejects.toMatchObject({
            extensions: {code: 1002}
        });

        expect(stubs.createWithTransaction).not.toHaveBeenCalled();
    });

    test("returns the limited user's existing reconstruction on the same neuron without counting", async () => {
        const existing = {id: "existing-1"};
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: existing});

        const [reconstruction, isExisting] = await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        expect(isExisting).toBe(true);
        expect(reconstruction).toBe(existing);
        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.createWithTransaction).not.toHaveBeenCalled();
    });

    test("does not limit an AnnotateMany user with something open", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateMany), {existing: null, openCount: 1});

        const [, isExisting] = await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        expect(isExisting).toBe(false);
        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.findByPk).not.toHaveBeenCalled();
        expect(stubs.createWithTransaction).toHaveBeenCalledTimes(1);
    });

    test("does not limit when enforceAnnotationLimit is false", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 1});

        const [, isExisting] = await Annotation.openAnnotation("neuron-1", "annotator-1", transaction, null, false);

        expect(isExisting).toBe(false);
        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.findByPk).not.toHaveBeenCalled();
        expect(stubs.createWithTransaction).toHaveBeenCalledTimes(1);
    });

    test("counts the annotator's reconstructions outside the limit-exempt statuses", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        const options = stubs.count.mock.calls[0][0];

        expect(options.where.annotatorId).toBe("annotator-1");
        expect(options.where.status[Op.notIn]).toBe(AnnotationLimitExemptStatuses);
        expect(options.transaction).toBe(transaction);
    });

    test("locks the annotator's row on the transaction before reading", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        expect(stubs.findByPk).toHaveBeenCalledWith("annotator-1", {
            transaction: transaction,
            lock: Transaction.LOCK.UPDATE
        });

        expect(stubs.findByPk.mock.invocationCallOrder[0]).toBeLessThan(stubs.findOne.mock.invocationCallOrder[0]);
        expect(stubs.findByPk.mock.invocationCallOrder[0]).toBeLessThan(stubs.count.mock.invocationCallOrder[0]);
    });
});

describe("openAnnotation with a self-owned transaction", () => {
    // Model.sequelize is a plain static assigned during init(), which never runs here, and TypeScript declares
    // it readonly -- so define the property rather than assigning it.
    function stubTransactionFactory() {
        const commit = vi.fn();
        const rollback = vi.fn();

        Object.defineProperty(Annotation, "sequelize", {
            value: {transaction: vi.fn().mockResolvedValue({commit, rollback})},
            configurable: true,
            writable: true
        });

        return {commit, rollback};
    }

    test("commits when resuming an existing reconstruction on the same neuron", async () => {
        stub(annotator(UserPermissions.AnnotateOne), {existing: {id: "existing-1"}});
        const {commit, rollback} = stubTransactionFactory();

        const [, isExisting] = await Annotation.openAnnotation("neuron-1", "annotator-1");

        expect(isExisting).toBe(true);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(rollback).not.toHaveBeenCalled();
    });

    test("commits on the create path", async () => {
        stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});
        const {commit, rollback} = stubTransactionFactory();

        const [, isExisting] = await Annotation.openAnnotation("neuron-1", "annotator-1");

        expect(isExisting).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);
        expect(rollback).not.toHaveBeenCalled();
    });

    test("rolls back, releasing the lock, when the limit refuses", async () => {
        stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 1});
        const {commit, rollback} = stubTransactionFactory();

        await expect(Annotation.openAnnotation("neuron-1", "annotator-1")).rejects.toMatchObject({
            extensions: {code: 1002}
        });

        expect(rollback).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
    });
});

describe("openAnnotation creates the children", () => {
    test("creates the specimen-space row before the atlas row, on the supplied transaction", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: null, openCount: 0});

        await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        expect(stubs.createSpecimenSpace).toHaveBeenCalledTimes(1);
        expect(stubs.createSpecimenSpace.mock.calls[0][1]).toEqual({status: SpecimenSpaceReconstructionStatus.Initialized, annotationId: "annotation-1"});
        expect(stubs.createSpecimenSpace.mock.calls[0][2]).toBe(transaction);
        expect(stubs.createSpecimenSpace.mock.invocationCallOrder[0]).toBeLessThan(stubs.createForShape.mock.invocationCallOrder[0]);
        expect(stubs.createForShape.mock.calls[0][1]).toMatchObject({annotationId: "annotation-1"});
    });

    test("an existing annotation creates neither child", async () => {
        const stubs = stub(annotator(UserPermissions.AnnotateOne), {existing: {id: "existing-1"}});

        await Annotation.openAnnotation("neuron-1", "annotator-1", transaction);

        expect(stubs.createSpecimenSpace).not.toHaveBeenCalled();
        expect(stubs.createForShape).not.toHaveBeenCalled();
    });
});
