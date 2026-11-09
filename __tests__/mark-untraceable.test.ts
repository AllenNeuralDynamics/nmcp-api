import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Annotation, UntraceableSourceStatuses} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {Transaction} = require("sequelize");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenNode} = require("../src/models/specimenNode");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {RawReconstruction} = require("../src/models/rawReconstruction");
const {RawReconstructionUpload} = require("../src/models/rawReconstructionUpload");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function annotationStub(status: number) {
    const annotation = Object.create(Annotation.prototype);
    annotation.id = "annotation-1";
    annotation.neuronId = "neuron-1";
    annotation.annotatorId = "annotator-1";
    annotation.status = status;
    annotation.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(annotation, update);
        return annotation;
    });
    annotation.destroy = vi.fn();
    return annotation;
}

const transaction = {sentinel: "t"};

function stub(status: number, user: any) {
    const annotation = annotationStub(status);

    vi.spyOn(Annotation, "findByPk").mockResolvedValue(annotation);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    // markUntraceable uses the callback form of transaction(), so the stub has to invoke the callback.  Model.sequelize
    // is a readonly static assigned during init(), which never runs here, so define it rather than assign it.
    Object.defineProperty(Annotation, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    return {
        annotation: annotation,
        discardAtlas: vi.spyOn(AtlasReconstruction, "discardForAnnotation").mockResolvedValue(undefined),
        discardSpecimenSpace: vi.spyOn(SpecimenSpaceReconstruction, "discardForAnnotation").mockResolvedValue(undefined),
        discardRaw: vi.spyOn(RawReconstruction, "discardForAnnotation").mockResolvedValue(undefined),
        discardRawUploads: vi.spyOn(RawReconstructionUpload, "discardForAnnotation").mockResolvedValue(undefined),
        findAtlas: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue({id: "atlas-1"}),
        destroyNodes: vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0),
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

const allStatuses = Object.keys(AnnotationStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => AnnotationStatus[key] as number);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Annotation as any).sequelize;
});

describe("markUntraceable authorization", () => {
    test.each([
        ["an admin", UserPermissions.Admin, "user-1"],
        ["the row's own annotator", UserPermissions.AnnotateOne, "annotator-1"],
        ["a peer reviewer", UserPermissions.PeerReview, "user-1"],
        ["a publish reviewer", UserPermissions.PublishReview, "user-1"]
    ])("allows %s", async (_label: string, permissions: number, id: string) => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(permissions, id));

        const annotation = await Annotation.markUntraceable("annotation-1", "user-1");

        expect(annotation.status).toBe(AnnotationStatus.Untraceable);
        expect(stubs.annotation.update).toHaveBeenCalledWith({status: AnnotationStatus.Untraceable}, expect.anything());
    });

    test("refuses an annotator who does not own the annotation", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-2"));

        await expect(Annotation.markUntraceable("annotation-1", "annotator-2")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.annotation.update).not.toHaveBeenCalled();
    });

    test("refuses when there is no user", async () => {
        const stubs = stub(AnnotationStatus.InProgress, null);

        await expect(Annotation.markUntraceable("annotation-1", "user-1")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.annotation.update).not.toHaveBeenCalled();
    });
});

describe("markUntraceable source status", () => {
    test.each(UntraceableSourceStatuses as number[])("allows source status %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await Annotation.markUntraceable("annotation-1", "user-1");

        expect(stubs.annotation.update).toHaveBeenCalledTimes(1);
    });

    test.each([
        AnnotationStatus.PeerReview,
        AnnotationStatus.PublishReview,
        AnnotationStatus.Approved,
        AnnotationStatus.WaitingForAtlasReconstruction,
        AnnotationStatus.ReadyToPublish,
        AnnotationStatus.Publishing,
        AnnotationStatus.Published,
        AnnotationStatus.Archived,
        AnnotationStatus.Untraceable,
        AnnotationStatus.Discarded
    ])("refuses source status %s even for an admin", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Annotation.markUntraceable("annotation-1", "user-1")).rejects.toThrow(/as untraceable/);

        expect(stubs.annotation.update).not.toHaveBeenCalled();
    });

    // The teardown below destroys the child, the quality control row and both node tables, so the state rule matters
    // more here than anywhere else: disregardAuth buys the import tools out of the permission and nothing more.
    test.each(UntraceableSourceStatuses as number[])("disregardAuth bypasses the predicate but not the source-status list, from %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.None, "annotator-2"));

        await Annotation.markUntraceable("annotation-1", "annotator-2", null, true);

        expect(stubs.annotation.update).toHaveBeenCalledTimes(1);
    });

    test.each(allStatuses.filter(status => !(UntraceableSourceStatuses as number[]).includes(status)))(
        "refuses source status %s under disregardAuth",
        async (status: number) => {
            const stubs = stub(status, userWith(UserPermissions.None, "annotator-2"));

            await expect(Annotation.markUntraceable("annotation-1", "annotator-2", null, true)).rejects.toThrow(/as untraceable/);

            expect(stubs.annotation.update).not.toHaveBeenCalled();
            expect(stubs.annotation.destroy).not.toHaveBeenCalled();
            expect(stubs.discardAtlas).not.toHaveBeenCalled();
            expect(stubs.destroyNodes).not.toHaveBeenCalled();
        });
});

describe("markUntraceable teardown", () => {
    test("soft-deletes the annotation and everything downstream of it", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        await Annotation.markUntraceable("annotation-1", "user-1");

        expect(stubs.annotation.destroy).toHaveBeenCalledTimes(1);
        expect(stubs.discardAtlas).toHaveBeenCalledTimes(1);
        expect(stubs.discardSpecimenSpace).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.discardAtlas.mock.invocationCallOrder[0]).toBeLessThan(stubs.discardSpecimenSpace.mock.invocationCallOrder[0]);
        expect(stubs.discardSpecimenSpace.mock.invocationCallOrder[0]).toBeLessThan(stubs.annotation.destroy.mock.invocationCallOrder[0]);
        expect(stubs.destroyNodes).not.toHaveBeenCalled();
    });

    test("records the event under its own kind", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        await Annotation.markUntraceable("annotation-1", "user-1");

        expect(stubs.create).toHaveBeenCalledTimes(1);
        expect(stubs.create.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.AnnotationUntraceable,
            name: "AnnotationUntraceable",
            targetId: "annotation-1"
        });
    });

    test("sets the status before deleting, so the row is identifiable afterwards", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        await Annotation.markUntraceable("annotation-1", "user-1");

        expect(stubs.annotation.update.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.annotation.destroy.mock.invocationCallOrder[0]);
    });
});

describe("markUntraceable raw teardown", () => {
    test("tears down the raw reconstruction and its upload history after the specimen space, before the destroy", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        await Annotation.markUntraceable("annotation-1", "user-1");

        expect(stubs.discardRaw).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.discardRawUploads).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.discardSpecimenSpace.mock.invocationCallOrder[0]).toBeLessThan(stubs.discardRaw.mock.invocationCallOrder[0]);
        expect(stubs.discardRaw.mock.invocationCallOrder[0]).toBeLessThan(stubs.discardRawUploads.mock.invocationCallOrder[0]);
        expect(stubs.discardRawUploads.mock.invocationCallOrder[0]).toBeLessThan(stubs.annotation.destroy.mock.invocationCallOrder[0]);
    });
});

// A raw upload at InProgress or Rejected writes under the annotation's lock, so the teardown takes discard's locks and
// decides again on what it reads under them.
describe("markUntraceable locking", () => {
    test("locks the child, then the annotation, before any teardown", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        await Annotation.markUntraceable("annotation-1", "user-1");

        expect(stubs.findAtlas).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, lock: Transaction.LOCK.UPDATE, transaction});
        expect(Annotation.findByPk).toHaveBeenCalledWith("annotation-1", {transaction, lock: Transaction.LOCK.UPDATE});

        const lockedRead = (Annotation.findByPk as any).mock.calls.findIndex((call: any[]) => call[1]?.lock == Transaction.LOCK.UPDATE);
        const lockedOrder = (Annotation.findByPk as any).mock.invocationCallOrder[lockedRead];

        expect(stubs.findAtlas.mock.invocationCallOrder[0]).toBeLessThan(lockedOrder);

        for (const teardown of [stubs.discardAtlas, stubs.discardSpecimenSpace, stubs.discardRaw, stubs.discardRawUploads]) {
            expect(lockedOrder).toBeLessThan(teardown.mock.invocationCallOrder[0]);
        }
    });

    test("refuses a status that moved under the lock", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));
        const locked = annotationStub(AnnotationStatus.PeerReview);

        (Annotation.findByPk as any).mockResolvedValueOnce(stubs.annotation).mockResolvedValueOnce(locked);

        await expect(Annotation.markUntraceable("annotation-1", "user-1"))
            .rejects.toThrow("Cannot mark a reconstruction with status PeerReview as untraceable.");

        for (const teardown of [stubs.discardAtlas, stubs.discardSpecimenSpace, stubs.discardRaw, stubs.discardRawUploads]) {
            expect(teardown).not.toHaveBeenCalled();
        }

        expect(locked.update).not.toHaveBeenCalled();
        expect(locked.destroy).not.toHaveBeenCalled();
    });

    test("refuses an annotation that is gone under the lock", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        (Annotation.findByPk as any).mockResolvedValueOnce(stubs.annotation).mockResolvedValueOnce(null);

        await expect(Annotation.markUntraceable("annotation-1", "user-1")).rejects.toThrow(/does not exist/);

        for (const teardown of [stubs.discardAtlas, stubs.discardSpecimenSpace, stubs.discardRaw, stubs.discardRawUploads]) {
            expect(teardown).not.toHaveBeenCalled();
        }

        expect(stubs.annotation.update).not.toHaveBeenCalled();
        expect(stubs.annotation.destroy).not.toHaveBeenCalled();
    });

    test("writes and returns the locked instance", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));
        const locked = annotationStub(AnnotationStatus.InProgress);

        (Annotation.findByPk as any).mockResolvedValueOnce(stubs.annotation).mockResolvedValueOnce(locked);

        const result = await Annotation.markUntraceable("annotation-1", "user-1");

        expect(result).toBe(locked);
        expect(locked.update).toHaveBeenCalledWith({status: AnnotationStatus.Untraceable}, {transaction});
        expect(locked.destroy).toHaveBeenCalledTimes(1);
        expect(stubs.annotation.update).not.toHaveBeenCalled();
        expect(stubs.annotation.destroy).not.toHaveBeenCalled();
    });

    test("disregardAuth still refuses a locked status outside the source list", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.None, "annotator-2"));
        const locked = annotationStub(AnnotationStatus.PublishReview);

        (Annotation.findByPk as any).mockResolvedValueOnce(stubs.annotation).mockResolvedValueOnce(locked);

        await expect(Annotation.markUntraceable("annotation-1", "annotator-2", null, true)).rejects.toThrow(/as untraceable/);

        expect(locked.update).not.toHaveBeenCalled();
    });

    test("refuses a caller who lost the permission under the lock", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));
        const locked = annotationStub(AnnotationStatus.InProgress);
        locked.annotatorId = "annotator-2";

        (Annotation.findByPk as any).mockResolvedValueOnce(stubs.annotation).mockResolvedValueOnce(locked);

        await expect(Annotation.markUntraceable("annotation-1", "annotator-1")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(locked.update).not.toHaveBeenCalled();
    });
});
