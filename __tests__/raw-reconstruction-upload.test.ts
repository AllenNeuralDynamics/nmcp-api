import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {RawReconstruction} = require("../src/models/rawReconstruction");
const {RawReconstructionUpload, RawReconstructionUploadFormat} = require("../src/models/rawReconstructionUpload");
const {RawReconstructionUploadStatus} = require("../src/models/rawReconstructionUploadStatus");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {SpecimenNode} = require("../src/models/specimenNode");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");
const simpleReconstruction = require("../src/io/simpleReconstruction");
const parquetParser = require("../src/io/parquetParser");

// Distinct sentinels, so a write can be traced to the attempt transactions or to the data transaction.
const attemptTransaction = {sentinel: "attempt"} as any;
const dataTransaction = {sentinel: "data"} as any;

const allStatuses = Object.keys(AnnotationStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => AnnotationStatus[key] as number);

const sourceStatuses = [AnnotationStatus.InProgress, AnnotationStatus.Rejected];

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function annotationStub(status: number, annotatorId: string | null = "annotator-1") {
    const annotation = Object.create(Annotation.prototype);
    annotation.id = "annotation-1";
    annotation.annotatorId = annotatorId;
    annotation.status = status;
    return annotation;
}

const somaNode = {index: 1, parentIndex: -1, structure: 1, x: 1, y: 2, z: 3, radius: 1, lengthToParent: 0};

// A minimal SimpleReconstruction stand-in.
function reconstructionData(options: {axonSoma?: any, dendriteSoma?: any} = {}) {
    const structure = (neuronStructureId: string, soma: any) => ({
        soma: soma,
        NeuronStructureId: neuronStructureId,
        nodeCounts: {total: 1, soma: 1, path: 0, branch: 0, end: 0},
        getNonSomaNodes: () => []
    });

    return {
        source: "test.swc",
        comments: "",
        axon: structure("ns-axon", "axonSoma" in options ? options.axonSoma : somaNode),
        dendrite: structure("ns-dendrite", "dendriteSoma" in options ? options.dendriteSoma : somaNode)
    };
}

function defineSequelize(model: any, transaction: any) {
    Object.defineProperty(model, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });
}

type SetupOptions = {
    eager?: any;
    attemptLocked?: any;
    dataLocked?: any;
    newest?: any;
    specimenSpaceNode?: (transaction: any) => any;
    data?: any;
};

function setup(status: number, options: SetupOptions = {}): any {
    const eager = "eager" in options ? options.eager : annotationStub(status);
    const attemptLocked = "attemptLocked" in options ? options.attemptLocked : annotationStub(status);
    const dataLocked = "dataLocked" in options ? options.dataLocked : annotationStub(status);

    defineSequelize(RawReconstructionUpload, attemptTransaction);
    defineSequelize(RawReconstruction, dataTransaction);

    const findAnnotation = vi.spyOn(Annotation, "findByPk").mockImplementation(async (...args: any[]) => {
        if (args[1]?.transaction === attemptTransaction) {
            return attemptLocked;
        }

        if (args[1]?.transaction === dataTransaction) {
            return dataLocked;
        }

        return eager;
    });

    const attempt = Object.create(RawReconstructionUpload.prototype);
    attempt.id = "attempt-1";
    attempt.annotationId = "annotation-1";
    attempt.update = vi.fn().mockResolvedValue(attempt);

    const findSpecimenNode = vi.spyOn(SpecimenNode, "findOne").mockImplementation(async (nodeOptions: any) => options.specimenSpaceNode?.(nodeOptions.transaction) ?? null);

    const findNewest = vi.spyOn(RawReconstructionUpload, "findOne").mockResolvedValue(options.newest ?? null);
    const create = vi.spyOn(RawReconstructionUpload, "create").mockResolvedValue(attempt);
    const createEvent = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    const deleteForReplacement = vi.spyOn(RawReconstruction, "deleteForReplacement").mockResolvedValue("raw-old");
    const createFromParsed = vi.spyOn(RawReconstruction, "createFromParsed").mockResolvedValue({id: "raw-new"});

    const data = options.data ?? reconstructionData();
    const parseSwc = vi.spyOn(simpleReconstruction, "parseSwcFile").mockResolvedValue(data);
    const parseParquet = vi.spyOn(parquetParser, "parseParquetUpload").mockResolvedValue(data);

    return {
        eager, attemptLocked, dataLocked, attempt, data,
        findAnnotation, findSpecimenNode, findNewest, create, createEvent, deleteForReplacement, createFromParsed, parseSwc, parseParquet
    };
}

function uploadArgs(extra: object = {}) {
    return {
        annotationId: "annotation-1",
        notes: "the notes",
        file: Promise.resolve({filename: "neuron.swc", createReadStream: () => "stream"}),
        ...extra
    };
}

function eventKinds(createEvent: any): number[] {
    return createEvent.mock.calls.map((call: any[]) => call[0].kind);
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (RawReconstructionUpload as any).sequelize;
    delete (RawReconstruction as any).sequelize;
});

describe.each([
    ["fromSwcUpload", RawReconstructionUploadFormat.Swc, "parseSwc", "The SWC file is missing."],
    ["fromParquetUpload", RawReconstructionUploadFormat.Parquet, "parseParquet", "The Parquet file is missing."]
])("RawReconstructionUpload.%s", (method: string, format: number, parser: string, missingMessage: string) => {
    function upload(user: any, args: any = uploadArgs()) {
        return RawReconstructionUpload[method](user, args);
    }

    test("refuses a missing file before anything else", async () => {
        const stubs = setup(AnnotationStatus.InProgress);

        await expect(upload(userWith(UserPermissions.Admin), uploadArgs({file: undefined}))).rejects.toThrow(missingMessage);

        expect(stubs.findAnnotation).not.toHaveBeenCalled();
        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("refuses an unknown annotation without recording an attempt", async () => {
        const stubs = setup(AnnotationStatus.InProgress, {eager: null});

        await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("Annotation annotation-1 does not exist");

        expect(stubs.create).not.toHaveBeenCalled();
    });

    describe("who may upload", () => {
        for (const status of sourceStatuses) {
            test.each([
                ["the owning annotator", UserPermissions.AnnotateOne, "annotator-1"],
                ["a peer reviewer", UserPermissions.PeerReview, "user-1"],
                ["a team reviewer", UserPermissions.TeamReview, "user-1"],
                ["a publish reviewer", UserPermissions.PublishReview, "user-1"],
                ["an admin", UserPermissions.Admin, "user-1"]
            ])(`admits %s at ${AnnotationStatus[status]}`, async (_label: string, permissions: number, id: string) => {
                const stubs = setup(status);

                expect(await upload(userWith(permissions, id))).toBe(stubs.attempt);
                expect(stubs.createFromParsed).toHaveBeenCalledTimes(1);
            });

            test.each([
                ["an AnnotateOne non-owner", UserPermissions.AnnotateOne],
                ["an AnnotateMany non-owner", UserPermissions.AnnotateMany],
                ["an Edit holder", UserPermissions.Edit]
            ])(`refuses %s at ${AnnotationStatus[status]} without recording an attempt`, async (_label: string, permissions: number) => {
                const stubs = setup(status);

                await expect(upload(userWith(permissions, "annotator-2"))).rejects.toBeInstanceOf(UnauthorizedError);

                expect(stubs.create).not.toHaveBeenCalled();
            });
        }

        test("refuses a user with no id on an annotation with no annotator", async () => {
            const unowned = annotationStub(AnnotationStatus.InProgress, null);
            const stubs = setup(AnnotationStatus.InProgress, {eager: unowned});
            const user = userWith(UserPermissions.AnnotateOne);
            user.id = undefined;

            await expect(upload(user)).rejects.toBeInstanceOf(UnauthorizedError);

            expect(stubs.create).not.toHaveBeenCalled();
        });
    });

    describe("the status gate", () => {
        test.each(allStatuses.filter(status => !sourceStatuses.includes(status)))("names %s to an admin and the owner", async (status: number) => {
            for (const user of [userWith(UserPermissions.Admin), userWith(UserPermissions.AnnotateOne, "annotator-1")]) {
                const stubs = setup(status);

                await expect(upload(user)).rejects.toMatchObject({
                    message: `Uploading the raw reconstruction is not allowed while in ${AnnotationStatus[status]}.`,
                    extensions: {code: 1009}
                });

                expect(stubs.create).not.toHaveBeenCalled();
                expect(stubs[parser]).not.toHaveBeenCalled();

                vi.restoreAllMocks();
            }
        });

        test("does not disclose the status to a caller who could never upload", async () => {
            const stubs = setup(AnnotationStatus.OnHold);

            await expect(upload(userWith(UserPermissions.AnnotateOne, "annotator-2"))).rejects.toBeInstanceOf(UnauthorizedError);

            expect(stubs.create).not.toHaveBeenCalled();
        });
    });

    describe("an annotation with specimen-space data", () => {
        const blockedMessage = "Uploading the raw reconstruction is not allowed once the annotation has specimen-space reconstruction data.";
        const specimenNode = {id: "specimen-node-1"};

        function specimenNodeLookup(transaction: any) {
            return {
                attributes: ["id"],
                include: [{model: SpecimenSpaceReconstruction, as: "Reconstruction", where: {annotationId: "annotation-1"}, attributes: []}],
                transaction: transaction
            };
        }

        test("is looked for in the nodes, so the empty specimen-space row does not refuse the upload", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            expect(await upload(userWith(UserPermissions.AnnotateOne, "annotator-1"))).toBe(stubs.attempt);

            expect(stubs.findSpecimenNode).toHaveBeenCalledWith(specimenNodeLookup(null));
            expect(stubs.findSpecimenNode).toHaveBeenCalledWith(specimenNodeLookup(attemptTransaction));
            expect(stubs.findSpecimenNode).toHaveBeenCalledWith(specimenNodeLookup(dataTransaction));
            expect(stubs.createFromParsed).toHaveBeenCalledTimes(1);
        });

        test.each(sourceStatuses)("is refused at %s without recording an attempt", async (status: number) => {
            const stubs = setup(status, {specimenSpaceNode: () => specimenNode});

            await expect(upload(userWith(UserPermissions.AnnotateOne, "annotator-1"))).rejects.toMatchObject({
                message: blockedMessage,
                extensions: {code: 1010}
            });

            expect(stubs.findSpecimenNode).toHaveBeenCalledWith(specimenNodeLookup(null));
            expect(stubs.create).not.toHaveBeenCalled();
            expect(stubs[parser]).not.toHaveBeenCalled();
        });

        test("is not disclosed to a caller who could never upload", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {specimenSpaceNode: () => specimenNode});

            await expect(upload(userWith(UserPermissions.AnnotateOne, "annotator-2"))).rejects.toBeInstanceOf(UnauthorizedError);

            expect(stubs.findSpecimenNode).not.toHaveBeenCalled();
        });

        test("is reported after the status gate", async () => {
            setup(AnnotationStatus.OnHold, {specimenSpaceNode: () => specimenNode});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1009}});
        });

        test("is re-checked under the attempt lock: one that appeared meanwhile is refused with no attempt", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {specimenSpaceNode: (transaction: any) => transaction === attemptTransaction ? specimenNode : null});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1010}});

            expect(stubs.findSpecimenNode).toHaveBeenCalledWith(specimenNodeLookup(attemptTransaction));
            expect(stubs.create).not.toHaveBeenCalled();
            expect(stubs[parser]).not.toHaveBeenCalled();
        });

        test("is re-checked under the data lock: one that appeared meanwhile fails the attempt and keeps the raw data", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {specimenSpaceNode: (transaction: any) => transaction === dataTransaction ? specimenNode : null});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1010}});

            expect(stubs.findSpecimenNode).toHaveBeenCalledWith(specimenNodeLookup(dataTransaction));
            expect(stubs.attempt.update).toHaveBeenCalledWith({status: RawReconstructionUploadStatus.FailedUpload, failureMessage: blockedMessage}, {transaction: attemptTransaction});
            expect(stubs.deleteForReplacement).not.toHaveBeenCalled();
            expect(stubs.createFromParsed).not.toHaveBeenCalled();
        });
    });

    describe("the attempt", () => {
        test("is committed under the annotation lock before the file is parsed", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            await upload(userWith(UserPermissions.Admin));

            expect(stubs.findAnnotation).toHaveBeenCalledWith("annotation-1", {transaction: attemptTransaction, lock: Transaction.LOCK.UPDATE});

            const lockedRead = stubs.findAnnotation.mock.calls.findIndex((call: any[]) => call[1]?.transaction === attemptTransaction);

            expect(stubs.findAnnotation.mock.invocationCallOrder[lockedRead]).toBeLessThan(stubs.create.mock.invocationCallOrder[0]);

            expect(stubs.create).toHaveBeenCalledWith({
                annotationId: "annotation-1",
                attemptNumber: 1,
                status: RawReconstructionUploadStatus.Uploading,
                userId: "user-1",
                sourceFilename: "neuron.swc",
                format: format
            }, {transaction: attemptTransaction});

            expect(stubs.create.mock.invocationCallOrder[0]).toBeLessThan(stubs[parser].mock.invocationCallOrder[0]);

            const createEvent: any = stubs.createEvent.mock.calls.find((call: any[]) => call[0].kind === EventLogItemKind.RawReconstructionUploadCreate);

            expect(createEvent[0]).toMatchObject({targetId: "attempt-1", parentId: "annotation-1"});
            expect(createEvent[1]).toEqual({transaction: attemptTransaction});
        });

        test("is numbered one past the newest, soft-deleted rows included", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {newest: {attemptNumber: 4}});

            await upload(userWith(UserPermissions.Admin));

            expect(stubs.findNewest).toHaveBeenCalledWith(expect.objectContaining({
                where: {annotationId: "annotation-1"},
                order: [["attemptNumber", "DESC"]],
                paranoid: false,
                transaction: attemptTransaction
            }));

            expect(stubs.create.mock.calls[0][0].attemptNumber).toBe(5);
        });

        test("re-runs the gate under the lock: a status that moved is refused with no attempt", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {attemptLocked: annotationStub(AnnotationStatus.OnHold)});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1009}});

            expect(stubs.create).not.toHaveBeenCalled();
            expect(stubs[parser]).not.toHaveBeenCalled();
        });

        test("re-runs the gate under the lock: an annotation that is gone is refused with no attempt", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {attemptLocked: null});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("does not exist");

            expect(stubs.create).not.toHaveBeenCalled();
            expect(stubs[parser]).not.toHaveBeenCalled();
        });
    });

    describe("a complete upload", () => {
        test("replaces the raw reconstruction under the annotation lock, then accepts the attempt", async () => {
            const stubs = setup(AnnotationStatus.Rejected);
            const user = userWith(UserPermissions.AnnotateOne, "annotator-1");

            const result = await upload(user);

            expect(result).toBe(stubs.attempt);

            expect(stubs.findAnnotation).toHaveBeenCalledWith("annotation-1", {transaction: dataTransaction, lock: Transaction.LOCK.UPDATE});
            expect(stubs.deleteForReplacement).toHaveBeenCalledWith("annotation-1", dataTransaction);
            expect(stubs.deleteForReplacement.mock.invocationCallOrder[0]).toBeLessThan(stubs.createFromParsed.mock.invocationCallOrder[0]);

            expect(stubs.createFromParsed).toHaveBeenCalledWith(user, {
                annotationId: "annotation-1",
                uploadId: "attempt-1",
                notes: "the notes",
                supersededId: "raw-old"
            }, stubs.data, somaNode, dataTransaction);

            expect(stubs.attempt.update).toHaveBeenCalledWith({status: RawReconstructionUploadStatus.Accepted, failureMessage: null}, {transaction: attemptTransaction});
            expect(eventKinds(stubs.createEvent)).toEqual([EventLogItemKind.RawReconstructionUploadCreate, EventLogItemKind.RawReconstructionUploadAccept]);
        });

        test("defaults omitted notes to an empty string", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            await upload(userWith(UserPermissions.Admin), uploadArgs({notes: undefined}));

            expect(stubs.createFromParsed.mock.calls[0][1].notes).toBe("");
        });

        test("takes the soma from the dendrite when the axon has none", async () => {
            const dendriteSoma = {...somaNode, index: 9};
            const stubs = setup(AnnotationStatus.InProgress, {data: reconstructionData({axonSoma: undefined, dendriteSoma})});

            await upload(userWith(UserPermissions.Admin));

            expect(stubs.createFromParsed.mock.calls[0][3]).toBe(dendriteSoma);
        });
    });

    describe("a failure after the attempt is recorded", () => {
        function expectFailedUpload(stubs: any, message: string) {
            expect(stubs.attempt.update).toHaveBeenCalledWith({status: RawReconstructionUploadStatus.FailedUpload, failureMessage: message}, {transaction: attemptTransaction});

            const failEvent: any = stubs.createEvent.mock.calls.find((call: any[]) => call[0].kind === EventLogItemKind.RawReconstructionUploadFail);

            expect(failEvent[0]).toMatchObject({targetId: "attempt-1", parentId: "annotation-1", details: {failureMessage: message}});
            expect(eventKinds(stubs.createEvent)).not.toContain(EventLogItemKind.RawReconstructionUploadAccept);
        }

        test("a parse error is recorded and rethrown, and no data transaction runs", async () => {
            const stubs = setup(AnnotationStatus.InProgress);
            const parseError = new Error("bad file");
            stubs[parser].mockRejectedValue(parseError);

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toBe(parseError);

            expectFailedUpload(stubs, "bad file");
            expect((RawReconstruction as any).sequelize.transaction).not.toHaveBeenCalled();
        });

        test("a file with no soma is recorded and rethrown", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {data: reconstructionData({axonSoma: undefined, dendriteSoma: undefined})});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("A soma was not found in the uploaded file.");

            expectFailedUpload(stubs, "A soma was not found in the uploaded file.");
            expect(stubs.createFromParsed).not.toHaveBeenCalled();
        });

        test.each([AnnotationStatus.OnHold, AnnotationStatus.PeerReview, AnnotationStatus.Discarded])(
            "a status that moved to %s under the data lock is recorded and rethrown as 1009",
            async (status: number) => {
                const stubs = setup(AnnotationStatus.InProgress, {dataLocked: annotationStub(status)});

                await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1009}});

                expectFailedUpload(stubs, `Uploading the raw reconstruction is not allowed while in ${AnnotationStatus[status]}.`);
                expect(stubs.deleteForReplacement).not.toHaveBeenCalled();
            });

        test("an annotation gone under the data lock is recorded and rethrown", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {dataLocked: null});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("Annotation annotation-1 does not exist");

            expectFailedUpload(stubs, "Annotation annotation-1 does not exist");
            expect(stubs.deleteForReplacement).not.toHaveBeenCalled();
        });

        test("a failing data write is recorded and rethrown", async () => {
            const stubs = setup(AnnotationStatus.InProgress);
            stubs.createFromParsed.mockRejectedValue(new Error("write failed"));

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("write failed");

            expectFailedUpload(stubs, "write failed");
        });

        test("a failing outcome write does not mask the original error", async () => {
            const stubs = setup(AnnotationStatus.InProgress);
            const parseError = new Error("bad file");
            stubs[parser].mockRejectedValue(parseError);
            stubs.attempt.update.mockRejectedValue(new Error("outcome write failed"));

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toBe(parseError);
        });
    });
});

describe("RawReconstructionUpload history", () => {
    test("findLatestForAnnotation orders by attemptNumber alone", async () => {
        const findOne = vi.spyOn(RawReconstructionUpload, "findOne").mockResolvedValue(null);

        await RawReconstructionUpload.findLatestForAnnotation("annotation-1");

        expect(findOne).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, order: [["attemptNumber", "DESC"]]});
    });

    test("discardForAnnotation soft-deletes the annotation's attempts", async () => {
        const destroy = vi.spyOn(RawReconstructionUpload, "destroy").mockResolvedValue(2);

        await RawReconstructionUpload.discardForAnnotation("annotation-1", dataTransaction);

        expect(destroy).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, transaction: dataTransaction});
        expect((destroy.mock.calls[0][0] as any).force).toBeUndefined();
    });

    function sourceRow(values: object) {
        return {toJSON: () => ({...values})};
    }

    test("copyForRevision re-creates every attempt on the revision, keeping every other value", async () => {
        const createdAt = new Date("2026-11-01T10:00:00.000Z");
        const updatedAt = new Date("2026-11-01T10:05:00.000Z");

        const accepted = {
            id: "attempt-a", annotationId: "annotation-1", attemptNumber: 1, status: RawReconstructionUploadStatus.Accepted,
            userId: "user-1", sourceFilename: "a.swc", format: RawReconstructionUploadFormat.Swc, failureMessage: null,
            createdAt, updatedAt
        };

        // The same createdAt as the first: the order must come from attemptNumber, not the timestamp or the id.
        const failed = {
            id: "attempt-b", annotationId: "annotation-1", attemptNumber: 2, status: RawReconstructionUploadStatus.FailedUpload,
            userId: "user-2", sourceFilename: "b.parquet", format: RawReconstructionUploadFormat.Parquet, failureMessage: "bad file",
            createdAt, updatedAt
        };

        const findAll = vi.spyOn(RawReconstructionUpload, "findAll").mockResolvedValue([sourceRow(accepted), sourceRow(failed)]);
        const bulkCreate = vi.spyOn(RawReconstructionUpload, "bulkCreate").mockResolvedValue([]);
        const createEvent = vi.spyOn(EventLogItem, "create");

        await RawReconstructionUpload.copyForRevision("annotation-1", "annotation-2", dataTransaction);

        expect(findAll).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, order: [["attemptNumber", "ASC"]], transaction: dataTransaction});
        expect(bulkCreate).toHaveBeenCalledTimes(1);

        const [copies, options]: any[] = bulkCreate.mock.calls[0];

        expect(options).toEqual({transaction: dataTransaction});
        expect(copies).toEqual([
            {...accepted, id: undefined, annotationId: "annotation-2"},
            {...failed, id: undefined, annotationId: "annotation-2"}
        ]);

        const newest = [...copies].sort((left: any, right: any) => right.attemptNumber - left.attemptNumber)[0];

        expect(newest.status).toBe(RawReconstructionUploadStatus.FailedUpload);
        expect(createEvent).not.toHaveBeenCalled();
    });

    test("copyForRevision with no source attempts creates nothing", async () => {
        vi.spyOn(RawReconstructionUpload, "findAll").mockResolvedValue([]);
        const bulkCreate = vi.spyOn(RawReconstructionUpload, "bulkCreate");

        await RawReconstructionUpload.copyForRevision("annotation-1", "annotation-2", dataTransaction);

        expect(bulkCreate).not.toHaveBeenCalled();
    });
});
