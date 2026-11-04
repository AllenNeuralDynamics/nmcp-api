import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation, PausableSourceStatuses, ResumableSourceStatuses, AnnotationLimitExemptStatuses} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

// annotator is the reconstruction's annotator as resumeAnnotation loads it under lock; it defaults to an
// AnnotateMany user so the limit stays out of tests that are not about it.
function stub(status: number, user: any, options: { annotator?: any, openCount?: number } = {}) {
    const reconstruction = Object.create(Annotation.prototype);
    reconstruction.id = "annotation-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });

    vi.spyOn(Annotation, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    const findAnnotator = vi.spyOn(User, "findByPk").mockResolvedValue(options.annotator ?? userWith(UserPermissions.AnnotateMany, "annotator-1"));
    const count = vi.spyOn(Annotation, "count").mockResolvedValue(options.openCount ?? 0);

    Object.defineProperty(Annotation, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
        configurable: true,
        writable: true
    });

    return {reconstruction, findAnnotator, count, create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})};
}

const allStatuses = Object.keys(AnnotationStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => AnnotationStatus[key] as number);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Annotation as any).sequelize;
});

// The three hold setters share one implementation and are held to one specification.
const holdSetters = [
    {method: "pauseAnnotation", status: AnnotationStatus.OnHold, kind: EventLogItemKind.AnnotationPause, refusal: /Cannot pause/},
    {method: "markIncomplete", status: AnnotationStatus.Incomplete, kind: EventLogItemKind.AnnotationIncomplete, refusal: /as incomplete/},
    {method: "markDuplicate", status: AnnotationStatus.Duplicate, kind: EventLogItemKind.AnnotationDuplicate, refusal: /as a duplicate/}
];

const nonPausableStatuses = allStatuses.filter(status => !(PausableSourceStatuses as number[]).includes(status));

describe.each(holdSetters)("$method", ({method, status: holdStatus, kind, refusal}) => {
    test.each(PausableSourceStatuses as number[])("allows source status %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const updated = await Annotation[method]("annotation-1", "annotator-1");

        expect(updated.status).toBe(holdStatus);
        expect(stubs.reconstruction.update).toHaveBeenCalledWith({status: holdStatus}, expect.anything());
    });

    test.each(nonPausableStatuses)("refuses source status %s even for an admin", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Annotation[method]("annotation-1", "user-1")).rejects.toThrow(refusal);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    // There are no direct moves between holds: a held reconstruction resumes first.
    test.each(ResumableSourceStatuses as number[])("refuses a reconstruction already held at %s - resume first", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Annotation[method]("annotation-1", "user-1")).rejects.toThrow(refusal);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("refuses another annotator", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-2"));

        await expect(Annotation[method]("annotation-1", "annotator-2")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("allows an admin who is not the annotator", async () => {
        stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        const updated = await Annotation[method]("annotation-1", "user-1");

        expect(updated.status).toBe(holdStatus);
    });

    // disregardAuth buys the import tools out of the permission and nothing else: the source list holds for them
    // exactly as it does for the portal.  The importer here holds no permission and is not the annotator.
    test.each(PausableSourceStatuses as number[])("disregardAuth bypasses the predicate but not the source list, from %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.None, "importer-1"));

        const updated = await Annotation[method]("annotation-1", "importer-1", null, true);

        expect(updated.status).toBe(holdStatus);
        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
    });

    test.each(nonPausableStatuses)("refuses source status %s under disregardAuth", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.None, "importer-1"));

        await expect(Annotation[method]("annotation-1", "importer-1", null, true)).rejects.toThrow(refusal);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("records its own event kind, and only that one", async () => {
        const stubs = stub(AnnotationStatus.InProgress, userWith(UserPermissions.Admin));

        await Annotation[method]("annotation-1", "user-1");

        expect(stubs.create.mock.calls).toHaveLength(1);
        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: kind});
    });
});

describe("resumeAnnotation", () => {
    test.each(ResumableSourceStatuses as number[])("allows %s and writes InProgress", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const updated = await Annotation.resumeAnnotation("annotation-1", "annotator-1");

        expect(updated.status).toBe(AnnotationStatus.InProgress);
        expect(stubs.reconstruction.update).toHaveBeenCalledWith({status: AnnotationStatus.InProgress}, expect.anything());
    });

    test.each(allStatuses.filter(status => !(ResumableSourceStatuses as number[]).includes(status)))(
        "refuses source status %s even for an admin",
        async (status: number) => {
            const stubs = stub(status, userWith(UserPermissions.Admin));

            await expect(Annotation.resumeAnnotation("annotation-1", "user-1")).rejects.toThrow(/Cannot resume/);

            expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        });

    test.each(ResumableSourceStatuses as number[])("records the resume event from %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await Annotation.resumeAnnotation("annotation-1", "user-1");

        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.AnnotationResume});
    });

    test("refuses another annotator", async () => {
        const stubs = stub(AnnotationStatus.OnHold, userWith(UserPermissions.AnnotateOne, "annotator-2"));

        await expect(Annotation.resumeAnnotation("annotation-1", "annotator-2")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("resumeAnnotation under the single-annotation limit", () => {
    const limited = () => userWith(UserPermissions.AnnotateOne, "annotator-1");

    test.each(ResumableSourceStatuses as number[])("refuses %s when the annotator has another annotation open", async (status: number) => {
        const stubs = stub(status, limited(), {annotator: limited(), openCount: 1});

        await expect(Annotation.resumeAnnotation("annotation-1", "annotator-1")).rejects.toMatchObject({
            extensions: {code: 1002}
        });

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        expect(stubs.create).not.toHaveBeenCalled();
    });

    test.each(ResumableSourceStatuses as number[])("allows %s when nothing else is open", async (status: number) => {
        const stubs = stub(status, limited(), {annotator: limited(), openCount: 0});

        const updated = await Annotation.resumeAnnotation("annotation-1", "annotator-1");

        expect(updated.status).toBe(AnnotationStatus.InProgress);
        expect(stubs.count).toHaveBeenCalledTimes(1);
    });

    test("holds an admin resuming on the annotator's behalf to the annotator's limit", async () => {
        const stubs = stub(AnnotationStatus.OnHold, userWith(UserPermissions.Admin), {annotator: limited(), openCount: 1});

        await expect(Annotation.resumeAnnotation("annotation-1", "user-1")).rejects.toMatchObject({
            extensions: {code: 1002}
        });

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("does not limit an AnnotateMany annotator", async () => {
        const stubs = stub(AnnotationStatus.OnHold, userWith(UserPermissions.AnnotateMany, "annotator-1"), {openCount: 1});

        const updated = await Annotation.resumeAnnotation("annotation-1", "annotator-1");

        expect(updated.status).toBe(AnnotationStatus.InProgress);
        expect(stubs.count).not.toHaveBeenCalled();
    });

    test("does not limit an annotator who holds no annotate permission", async () => {
        const stubs = stub(AnnotationStatus.OnHold, userWith(UserPermissions.Admin), {annotator: userWith(UserPermissions.None, "annotator-1"), openCount: 1});

        const updated = await Annotation.resumeAnnotation("annotation-1", "user-1");

        expect(updated.status).toBe(AnnotationStatus.InProgress);
        expect(stubs.count).not.toHaveBeenCalled();
    });

    test("locks the annotator's row and counts their other reconstructions outside the exempt statuses", async () => {
        const stubs = stub(AnnotationStatus.OnHold, limited(), {annotator: limited(), openCount: 0});

        await Annotation.resumeAnnotation("annotation-1", "annotator-1");

        expect(stubs.findAnnotator).toHaveBeenCalledWith("annotator-1", {transaction: expect.anything(), lock: Transaction.LOCK.UPDATE});
        expect(stubs.findAnnotator.mock.invocationCallOrder[0]).toBeLessThan(stubs.count.mock.invocationCallOrder[0]);

        const where = stubs.count.mock.calls[0][0].where;

        expect(where.annotatorId).toBe("annotator-1");
        expect(where.status[Op.notIn]).toBe(AnnotationLimitExemptStatuses);
        expect(where.id[Op.ne]).toBe("annotation-1");
    });
});
