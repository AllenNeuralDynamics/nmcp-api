import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function annotationStub(properties: object) {
    const annotation = Object.create(Annotation.prototype);

    Object.assign(annotation, properties);

    annotation.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(annotation, update);
        return annotation;
    });

    return annotation;
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Annotation as any).sequelize;
});

describe("revision copy", () => {
    test("a revision copy does not carry the DOI", async () => {
        const source = annotationStub({id: "annotation-1", doi: "10.x/source", notes: "the notes", durationHours: 3.5});
        const revision = annotationStub({id: "annotation-2", doi: ""});

        const copyFrom = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(SpecimenSpaceReconstruction, "findOne").mockResolvedValue({copyFrom: copyFrom});

        await (revision as any).copyFrom(source, userWith(UserPermissions.Admin), transaction);

        expect(revision.update).toHaveBeenCalledTimes(1);
        expect(revision.update.mock.calls[0][0]).toEqual({status: AnnotationStatus.InProgress, notes: "the notes", durationHours: 3.5});
        expect(revision.doi).toBe("");
    });
});

describe("Annotation.publish", () => {
    function publishable(doi: string) {
        const annotation = annotationStub({
            id: "annotation-1",
            status: AnnotationStatus.ReadyToPublish,
            doi: doi,
            AtlasReconstruction: {nodeCounts: {}},
            Neuron: {canonicalDoi: "10.x/canonical"}
        });

        vi.spyOn(Annotation, "findByPk").mockResolvedValue(annotation);
        vi.spyOn(User, "findUserOrId").mockResolvedValue(userWith(UserPermissions.Admin));

        // Resolves a sentinel without running the callback: these tests are about the checks before the transaction.
        const transactionFn = vi.fn().mockResolvedValue("published");

        Object.defineProperty(Annotation, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});

        return transactionFn;
    }

    test("refuses an annotation with no DOI before opening a transaction", async () => {
        const transactionFn = publishable("");

        await expect(Annotation.publish(userWith(UserPermissions.Admin), "annotation-1"))
            .rejects.toThrow("The reconstruction has no DOI assigned");

        expect(transactionFn).not.toHaveBeenCalled();
    });

    test("proceeds to its transaction when the annotation has a DOI", async () => {
        const transactionFn = publishable("10.x/abc");

        expect(await Annotation.publish(userWith(UserPermissions.Admin), "annotation-1")).toBe("published");

        expect(transactionFn).toHaveBeenCalledTimes(1);
    });
});
