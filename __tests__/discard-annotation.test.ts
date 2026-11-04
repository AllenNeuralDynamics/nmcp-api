import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation, DiscardableSourceStatuses, AdminDiscardableSourceStatuses} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {SpecimenNode} = require("../src/models/specimenNode");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
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

    const annotation = Object.create(Annotation.prototype);
    annotation.id = "annotation-1";
    annotation.neuronId = "neuron-1";
    annotation.annotatorId = "annotator-1";
    annotation.status = status;
    annotation.AtlasReconstruction = atlasReconstruction;
    annotation.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(annotation, update);
        return annotation;
    });
    annotation.destroy = vi.fn();

    const findByPk = vi.spyOn(Annotation, "findByPk").mockResolvedValue(annotation);
    const findAtlas = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any);

    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    Object.defineProperty(Annotation, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    return {
        annotation: annotation,
        findByPk: findByPk,
        findAtlas: findAtlas,
        discardAtlas: vi.spyOn(AtlasReconstruction, "discardForAnnotation").mockResolvedValue(undefined),
        discardSpecimenSpace: vi.spyOn(SpecimenSpaceReconstruction, "discardForAnnotation").mockResolvedValue(undefined),
        destroyNodes: vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0),
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Annotation as any).sequelize;
});

describe("discardAnnotation as the annotator", () => {
    test.each(DiscardableSourceStatuses as number[])("discards from %s", async (status: number) => {
        stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const discarded = await Annotation.discardAnnotation("annotation-1", "annotator-1");

        expect(discarded.status).toBe(AnnotationStatus.Discarded);
    });

    test.each(AdminDiscardableSourceStatuses as number[])("is refused at %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await expect(Annotation.discardAnnotation("annotation-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.annotation.destroy).not.toHaveBeenCalled();
    });
});

describe("discardAnnotation as an admin", () => {
    test.each([...DiscardableSourceStatuses, ...AdminDiscardableSourceStatuses] as number[])("discards from %s", async (status: number) => {
        stub(status, userWith(UserPermissions.Admin));

        const discarded = await Annotation.discardAnnotation("annotation-1", "user-1");

        expect(discarded.status).toBe(AnnotationStatus.Discarded);
    });
});

/**
 * B1 and B2: the ways out of a pipeline that cannot finish, and of a result a reviewer decides should not be published.
 * Both are "PublishReview holder or admin" - a third permission shape neither existing source list expresses, and
 * specifically not the annotator's.
 */
describe("discardAnnotation past approval", () => {
    test.each(abandonableFailures)("a publish reviewer discards a child stopped at %s", async (childStatus: number) => {
        stub(AnnotationStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.PublishReview), childStatus);

        const discarded = await Annotation.discardAnnotation("annotation-1", "user-1");

        expect(discarded.status).toBe(AnnotationStatus.Discarded);
    });

    test.each(abandonableFailures)("an admin discards a child stopped at %s", async (childStatus: number) => {
        stub(AnnotationStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.Admin), childStatus);

        const discarded = await Annotation.discardAnnotation("annotation-1", "user-1");

        expect(discarded.status).toBe(AnnotationStatus.Discarded);
    });

    test.each([
        ["a publish reviewer", UserPermissions.PublishReview],
        ["an admin", UserPermissions.Admin]
    ])("%s discards from ReadyToPublish", async (_label: string, permissions: number) => {
        stub(AnnotationStatus.ReadyToPublish, userWith(permissions), AtlasReconstructionStatus.ReadyToPublish);

        const discarded = await Annotation.discardAnnotation("annotation-1", "user-1");

        expect(discarded.status).toBe(AnnotationStatus.Discarded);
    });

    test.each([...abandonableFailures.map(status => [AnnotationStatus.WaitingForAtlasReconstruction, status]),
        [AnnotationStatus.ReadyToPublish, AtlasReconstructionStatus.ReadyToPublish]])(
        "the annotator alone is refused at parent %s, child %s",
        async (status: number, childStatus: number) => {
            const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"), childStatus);

            await expect(Annotation.discardAnnotation("annotation-1", "annotator-1"))
                .rejects.toBeInstanceOf(UnauthorizedError);

            expect(stubs.annotation.destroy).not.toHaveBeenCalled();
        });

    test("tears down the same way on the new route", async () => {
        const stubs = stub(AnnotationStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.PublishReview), AtlasReconstructionStatus.FailedDoiAssignment);

        await Annotation.discardAnnotation("annotation-1", "user-1");

        expect(stubs.discardAtlas).toHaveBeenCalledTimes(1);
        expect(stubs.discardSpecimenSpace).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.annotation.destroy).toHaveBeenCalledTimes(1);
    });
});

describe("discardAnnotation refused statuses", () => {
    // The status problem is reported as such rather than as Unauthorized, whoever is asking.
    test.each([
        AnnotationStatus.Approved,
        AnnotationStatus.Publishing,
        AnnotationStatus.Published,
        AnnotationStatus.PublishFailed,
        AnnotationStatus.Archived
    ])("refuses %s for everyone, with the status-shaped error", async (status: number) => {
        for (const user of [userWith(UserPermissions.Admin), userWith(UserPermissions.AnnotateOne, "annotator-1")]) {
            vi.restoreAllMocks();

            const stubs = stub(status, user);

            await expect(Annotation.discardAnnotation("annotation-1", user.id))
                .rejects.toThrow(/Cannot discard a reconstruction/);

            expect(stubs.annotation.destroy).not.toHaveBeenCalled();
        }
    });

    // The pairing reject now admits, and the one discard must go on refusing: B3 hands PublishFailed a single route
    // back and it is not this one.  Throwing away a annotation that got as far as publishing is a reject followed
    // by an ordinary discard from Rejected, which is two deliberate acts rather than one.
    test("refuses a PublishFailed parent whose child failed indexing, which reject now admits", async () => {
        const stubs = stub(AnnotationStatus.PublishFailed, userWith(UserPermissions.Admin), AtlasReconstructionStatus.FailedSearchIndexing);

        await expect(Annotation.discardAnnotation("annotation-1", "user-1"))
            .rejects.toThrow(/Cannot discard a reconstruction/);

        expect(stubs.annotation.destroy).not.toHaveBeenCalled();
    });

    // WaitingForAtlasReconstruction is not blanket-discardable: a annotation with a phase actually running, or one
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
        const stubs = stub(AnnotationStatus.WaitingForAtlasReconstruction, userWith(UserPermissions.Admin), childStatus);

        await expect(Annotation.discardAnnotation("annotation-1", "user-1"))
            .rejects.toThrow(/Cannot discard a reconstruction/);

        expect(stubs.annotation.destroy).not.toHaveBeenCalled();
    });
});

describe("discardAnnotation teardown", () => {
    test("soft-deletes the annotation and everything downstream of it", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Annotation.discardAnnotation("annotation-1", "annotator-1");

        expect(stubs.discardAtlas).toHaveBeenCalledTimes(1);
        expect(stubs.discardSpecimenSpace).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.annotation.destroy).toHaveBeenCalledTimes(1);
    });

    test("tears down the specimen-space row after the atlas child and before the annotation", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Annotation.discardAnnotation("annotation-1", "annotator-1");

        expect(stubs.discardSpecimenSpace).toHaveBeenCalledTimes(1);
        expect(stubs.discardSpecimenSpace).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.discardAtlas.mock.invocationCallOrder[0]).toBeLessThan(stubs.discardSpecimenSpace.mock.invocationCallOrder[0]);
        expect(stubs.discardSpecimenSpace.mock.invocationCallOrder[0]).toBeLessThan(stubs.annotation.destroy.mock.invocationCallOrder[0]);
        expect(stubs.destroyNodes).not.toHaveBeenCalled();
    });

    test("still tears down on the admin-only route", async () => {
        const stubs = stub(AnnotationStatus.PublishReview, userWith(UserPermissions.Admin));

        await Annotation.discardAnnotation("annotation-1", "user-1");

        expect(stubs.discardAtlas).toHaveBeenCalledTimes(1);
        expect(stubs.discardSpecimenSpace).toHaveBeenCalledWith("annotation-1", transaction);
        expect(stubs.annotation.destroy).toHaveBeenCalledTimes(1);
    });
});

describe("discardAnnotation serialization", () => {
    test("locks the child before the parent, inside the one transaction", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Annotation.discardAnnotation("annotation-1", "annotator-1");

        expect(stubs.findAtlas).toHaveBeenCalledWith({
            where: {annotationId: "annotation-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        const lockedParentCall = stubs.findByPk.mock.calls.findIndex((call: any) => call[1]?.lock === Transaction.LOCK.UPDATE);

        expect(lockedParentCall).toBeGreaterThanOrEqual(0);
        expect(stubs.findAtlas.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.findByPk.mock.invocationCallOrder[lockedParentCall]);
    });
});
