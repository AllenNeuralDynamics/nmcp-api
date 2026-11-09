import {expect, test, vi, describe, afterEach, beforeEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const uuid = require("uuid");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {Neuron} = require("../src/models/neuron");
const {NeuronStructure} = require("../src/models/neuronStructure");
const {RawReconstruction} = require("../src/models/rawReconstruction");
const {RawReconstructionUpload, RawReconstructionUploadFormat} = require("../src/models/rawReconstructionUpload");
const {RawReconstructionUploadStatus} = require("../src/models/rawReconstructionUploadStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");
const {CoreServiceOptions} = require("../src/options/coreServicesOptions");
const {PrecomputedService, PrecomputedServiceStatus} = require("../src/data-access/precomputedService");
const {QualityCheckService, QualityCheckServiceStatus, toQualityControlOutput} = require("../src/data-access/qualityCheckService");
const simpleReconstruction = require("../src/io/simpleReconstruction");
const parquetParser = require("../src/io/parquetParser");
const files = require("../src/io/rawQualityControlFiles");
const nmcpQcDocument = require("./fixtures/nmcp-qc-document.json");

// Distinct sentinels, so a write can be traced to the upload's transaction or to the worker's finish.
const uploadTransaction = {sentinel: "upload"} as any;
const finishTransaction = {sentinel: "finish"} as any;

const skeletonBase = "s3://bucket/qc-skeletons";

const allStatuses = Object.keys(AnnotationStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => AnnotationStatus[key] as number);

const preReviewStatuses = [AnnotationStatus.InProgress, AnnotationStatus.Rejected];

const reviewStatuses: [number, number][] = [
    [AnnotationStatus.PeerReview, UserPermissions.PeerReview],
    [AnnotationStatus.TeamReview, UserPermissions.TeamReview],
    [AnnotationStatus.PublishReview, UserPermissions.PublishReview]
];

const sourceStatuses = [...preReviewStatuses, ...reviewStatuses.map(([status]) => status)];

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
    annotation.neuronId = "neuron-1";
    annotation.status = status;
    return annotation;
}

function attemptStub(values: object = {}) {
    const attempt = Object.create(RawReconstructionUpload.prototype);
    Object.assign(attempt, {id: "attempt-1", annotationId: "annotation-1", userId: "user-1", qcTag: null, ...values});
    attempt.update = vi.fn().mockResolvedValue(attempt);
    return attempt;
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
        comments: "# comment\n",
        axon: structure("ns-axon", "axonSoma" in options ? options.axonSoma : somaNode),
        dendrite: structure("ns-dendrite", "dendriteSoma" in options ? options.dendriteSoma : somaNode)
    };
}

function defineSequelize(model: any, transaction: any, committed: any = vi.fn()) {
    Object.defineProperty(model, "sequelize", {
        value: {
            transaction: vi.fn().mockImplementation(async (callback: any) => {
                const result = await callback(transaction);
                committed();
                return result;
            })
        },
        configurable: true,
        writable: true
    });
}

function eventKinds(createEvent: any): number[] {
    return createEvent.mock.calls.map((call: any[]) => call[0].kind);
}

function precomputedSuccess() {
    return {serviceStatus: PrecomputedServiceStatus.Success, errorKind: null, errorDescription: null, httpStatus: null};
}

let savedQualityControl: any;

beforeEach(() => {
    savedQualityControl = {...CoreServiceOptions.qualityControl};
    Object.assign(CoreServiceOptions.qualityControl, {
        skeletonOutput: skeletonBase + "/",
        blobOutput: "/data/qc",
        aindMetadataUrl: "https://metadata.example.org"
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(CoreServiceOptions.qualityControl, savedQualityControl);
    delete (RawReconstructionUpload as any).sequelize;
});

type SetupOptions = {
    eager?: any;
    locked?: any;
    latest?: any;
    newest?: any;
    data?: any;
};

function setup(status: number, options: SetupOptions = {}): any {
    const eager = "eager" in options ? options.eager : annotationStub(status);
    const locked = "locked" in options ? options.locked : annotationStub(status);

    const committed = vi.fn();

    defineSequelize(RawReconstructionUpload, uploadTransaction, committed);

    const findAnnotation = vi.spyOn(Annotation, "findByPk").mockImplementation(async (...args: any[]) => {
        return args[1]?.transaction === uploadTransaction ? locked : eager;
    });

    const attempt = attemptStub();

    // The in-progress gate reads the latest live attempt; the numbering reads the newest, soft-deleted included.
    const findOne = vi.spyOn(RawReconstructionUpload, "findOne").mockImplementation(async (query: any) => {
        return query.paranoid === false ? (options.newest ?? null) : (options.latest ?? null);
    });

    const create = vi.spyOn(RawReconstructionUpload, "create").mockImplementation(async (values: any) => Object.assign(attempt, values));
    const createEvent = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    const deleteForReplacement = vi.spyOn(RawReconstruction, "deleteForReplacement").mockResolvedValue("raw-old");
    const createFromParsed = vi.spyOn(RawReconstruction, "createFromParsed").mockResolvedValue({id: "raw-new"});

    const data = options.data ?? reconstructionData();
    const parseSwc = vi.spyOn(simpleReconstruction, "parseSwcFile").mockResolvedValue(data);
    const parseParquet = vi.spyOn(parquetParser, "parseParquetUpload").mockResolvedValue(data);

    const findNeuron = vi.spyOn(Neuron, "findByPk").mockResolvedValue({label: "N1", Specimen: {label: "S1", Genotype: {name: "G1"}}});

    const generateSkeleton = vi.spyOn(PrecomputedService, "generateSkeleton").mockResolvedValue(precomputedSuccess());

    const writeUploadFile = vi.spyOn(files, "writeUploadFile").mockResolvedValue(undefined);
    const removeDocument = vi.spyOn(files, "removeQualityControlDocument").mockResolvedValue(undefined);
    const publishDocument = vi.spyOn(files, "publishQualityControlDocument").mockResolvedValue(undefined);

    const startQualityControl = vi.spyOn(RawReconstructionUpload, "startQualityControl").mockResolvedValue(undefined);

    return {
        eager, locked, attempt, data, committed,
        findAnnotation, findOne, create, createEvent, deleteForReplacement, createFromParsed,
        parseSwc, parseParquet, findNeuron, generateSkeleton, writeUploadFile, removeDocument, publishDocument, startQualityControl
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

function expectNoAttempt(stubs: any) {
    expect(stubs.create).not.toHaveBeenCalled();
    expect(stubs.generateSkeleton).not.toHaveBeenCalled();
    expect(stubs.startQualityControl).not.toHaveBeenCalled();
}

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
        expectNoAttempt(stubs);
    });

    test("refuses an unknown annotation without recording an attempt", async () => {
        const stubs = setup(AnnotationStatus.InProgress, {eager: null});

        await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("Annotation annotation-1 does not exist");

        expectNoAttempt(stubs);
    });

    describe("who may upload", () => {
        for (const status of preReviewStatuses) {
            test.each([
                ["the owning annotator", UserPermissions.AnnotateOne, "annotator-1"],
                ["a peer reviewer", UserPermissions.PeerReview, "user-1"],
                ["a team reviewer", UserPermissions.TeamReview, "user-1"],
                ["a publish reviewer", UserPermissions.PublishReview, "user-1"],
                ["an admin", UserPermissions.Admin, "user-1"]
            ])(`admits %s at ${AnnotationStatus[status]}`, async (_label: string, permissions: number, id: string) => {
                const stubs = setup(status);

                expect(await upload(userWith(permissions, id))).toBe(stubs.attempt);
                expect(stubs.startQualityControl).toHaveBeenCalledTimes(1);
            });

            test.each([
                ["an AnnotateOne non-owner", UserPermissions.AnnotateOne],
                ["an AnnotateMany non-owner", UserPermissions.AnnotateMany],
                ["an Edit holder", UserPermissions.Edit]
            ])(`refuses %s at ${AnnotationStatus[status]} without recording an attempt`, async (_label: string, permissions: number) => {
                const stubs = setup(status);

                await expect(upload(userWith(permissions, "annotator-2"))).rejects.toBeInstanceOf(UnauthorizedError);

                expectNoAttempt(stubs);
            });
        }

        for (const [status, reviewBit] of reviewStatuses) {
            const otherReviewBits = [UserPermissions.PeerReview, UserPermissions.TeamReview, UserPermissions.PublishReview].filter(bit => bit != reviewBit);

            test.each([
                ["the matching reviewer", reviewBit],
                ["an admin", UserPermissions.Admin]
            ])(`admits %s at ${AnnotationStatus[status]}`, async (_label: string, permissions: number) => {
                const stubs = setup(status);

                expect(await upload(userWith(permissions))).toBe(stubs.attempt);
                expect(stubs.startQualityControl).toHaveBeenCalledTimes(1);
            });

            test.each([
                ["the owning annotator", UserPermissions.AnnotateOne, "annotator-1"],
                ["another reviewer", otherReviewBits[0], "user-1"],
                ["the other reviewer", otherReviewBits[1], "user-1"],
                ["an AnnotateMany non-owner", UserPermissions.AnnotateMany, "annotator-2"]
            ])(`refuses %s at ${AnnotationStatus[status]} with a 401 and no attempt`, async (_label: string, permissions: number, id: string) => {
                const stubs = setup(status);

                await expect(upload(userWith(permissions, id))).rejects.toBeInstanceOf(UnauthorizedError);

                expectNoAttempt(stubs);
            });
        }

        test("re-checks the review bit under the lock: a status that moved past the caller's review is refused", async () => {
            const stubs = setup(AnnotationStatus.PeerReview, {locked: annotationStub(AnnotationStatus.TeamReview)});

            await expect(upload(userWith(UserPermissions.PeerReview))).rejects.toBeInstanceOf(UnauthorizedError);

            expectNoAttempt(stubs);
            expect(stubs[parser]).not.toHaveBeenCalled();
        });

        test("refuses a user with no id on an annotation with no annotator", async () => {
            const unowned = annotationStub(AnnotationStatus.InProgress, null);
            const stubs = setup(AnnotationStatus.InProgress, {eager: unowned});
            const user = userWith(UserPermissions.AnnotateOne);
            user.id = undefined;

            await expect(upload(user)).rejects.toBeInstanceOf(UnauthorizedError);

            expectNoAttempt(stubs);
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

                expectNoAttempt(stubs);
                expect(stubs[parser]).not.toHaveBeenCalled();

                vi.restoreAllMocks();
            }
        });

        test("does not disclose the status to a caller who could never upload", async () => {
            const stubs = setup(AnnotationStatus.OnHold);

            await expect(upload(userWith(UserPermissions.AnnotateOne, "annotator-2"))).rejects.toBeInstanceOf(UnauthorizedError);

            expectNoAttempt(stubs);
        });

        test("re-runs the gate under the lock: a status that moved is refused with no attempt", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {locked: annotationStub(AnnotationStatus.OnHold)});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1009}});

            expectNoAttempt(stubs);
            expect(stubs[parser]).not.toHaveBeenCalled();
        });

        test("re-runs the gate under the lock: an annotation that is gone is refused with no attempt", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {locked: null});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("does not exist");

            expectNoAttempt(stubs);
            expect(stubs[parser]).not.toHaveBeenCalled();
        });
    });

    describe("the quality control configuration", () => {
        test.each(["skeletonOutput", "blobOutput", "aindMetadataUrl"])("without %s the upload is refused with 1012, no lock and no attempt", async (key: string) => {
            const stubs = setup(AnnotationStatus.InProgress);
            CoreServiceOptions.qualityControl[key] = "";

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1012}});

            expect((RawReconstructionUpload as any).sequelize.transaction).not.toHaveBeenCalled();
            expectNoAttempt(stubs);
        });
    });

    describe("an attempt still in quality control", () => {
        const staleTag = "0196a2c4-0000-7000-8000-0000000000ff";

        function pending(ageMilliseconds: number) {
            return attemptStub({
                id: "attempt-pending",
                status: RawReconstructionUploadStatus.PendingQualityControl,
                qcTag: staleTag,
                createdAt: new Date(Date.now() - ageMilliseconds)
            });
        }

        test("refuses the upload with 1011 when under an hour old", async () => {
            const latest = pending(10 * 60 * 1000);
            const stubs = setup(AnnotationStatus.InProgress, {latest});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1011}});

            expect(stubs.findOne).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, order: [["attemptNumber", "DESC"]], transaction: uploadTransaction});
            expect(latest.update).not.toHaveBeenCalled();
            expect(stubs[parser]).not.toHaveBeenCalled();
            expectNoAttempt(stubs);
        });

        test("closes one over an hour old, after removing its document, and proceeds", async () => {
            const latest = pending(2 * 60 * 60 * 1000);
            const stubs = setup(AnnotationStatus.InProgress, {latest});

            expect(await upload(userWith(UserPermissions.Admin))).toBe(stubs.attempt);

            expect(stubs.removeDocument).toHaveBeenCalledWith(staleTag);
            expect(latest.update).toHaveBeenCalledWith({
                status: RawReconstructionUploadStatus.FailedQualityControlService,
                failureMessage: "Quality control did not finish within an hour and was closed by a newer upload."
            }, {transaction: uploadTransaction});
            expect(stubs.removeDocument.mock.invocationCallOrder[0]).toBeLessThan(latest.update.mock.invocationCallOrder[0]);

            const failEvent: any = stubs.createEvent.mock.calls.find((call: any[]) => call[0].targetId === "attempt-pending");

            expect(failEvent[0]).toMatchObject({kind: EventLogItemKind.RawReconstructionUploadFail});
            expect(failEvent[1]).toEqual({transaction: uploadTransaction});

            expect(stubs.create).toHaveBeenCalledTimes(1);
            expect(stubs.startQualityControl).toHaveBeenCalledTimes(1);
        });

        test("a stale document that cannot be removed refuses the upload with 1012 and keeps the attempt pending", async () => {
            const latest = pending(2 * 60 * 60 * 1000);
            const stubs = setup(AnnotationStatus.InProgress, {latest});
            stubs.removeDocument.mockRejectedValue(new Error("EACCES"));

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1012}});

            expect(latest.update).not.toHaveBeenCalled();
            expect(stubs[parser]).not.toHaveBeenCalled();
            expectNoAttempt(stubs);
        });

        test.each([
            RawReconstructionUploadStatus.Accepted,
            RawReconstructionUploadStatus.FailedQualityControl,
            RawReconstructionUploadStatus.FailedPrecomputed
        ])("a latest attempt that finished as %s does not block", async (status: number) => {
            const stubs = setup(AnnotationStatus.InProgress, {latest: attemptStub({status, createdAt: new Date()})});

            expect(await upload(userWith(UserPermissions.Admin))).toBe(stubs.attempt);
        });
    });

    describe("a successful hand-off", () => {
        test("locks the annotation before parsing and before the skeleton call", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            await upload(userWith(UserPermissions.Admin));

            expect(stubs.findAnnotation).toHaveBeenCalledWith("annotation-1", {transaction: uploadTransaction, lock: Transaction.LOCK.UPDATE});

            const lockedRead = stubs.findAnnotation.mock.calls.findIndex((call: any[]) => call[1]?.transaction === uploadTransaction);
            const lockOrder = stubs.findAnnotation.mock.invocationCallOrder[lockedRead];

            expect(lockOrder).toBeLessThan(stubs[parser].mock.invocationCallOrder[0]);
            expect(lockOrder).toBeLessThan(stubs.generateSkeleton.mock.invocationCallOrder[0]);
        });

        test("builds the skeleton at <base>/precomputed/nmcp-qc-<qc-tag>, segment 1, from the reconstruction rows", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            await upload(userWith(UserPermissions.Admin));

            const [location, segmentId, reconstruction] = stubs.generateSkeleton.mock.calls[0];

            expect(uuid.validate(reconstruction.id)).toBe(true);
            expect(uuid.version(reconstruction.id)).toBe(7);
            expect(location).toBe(`${skeletonBase}/precomputed/nmcp-qc-${reconstruction.id}`);
            expect(segmentId).toBe(1);
            expect(reconstruction).toEqual({
                id: reconstruction.id,
                neuron: {label: "N1", specimen: {label: "S1", genotype: "G1"}},
                nodes: simpleReconstruction.toNodeData(simpleReconstruction.toReconstructionRows(stubs.data))
            });
            expect(stubs.findNeuron).toHaveBeenCalledWith("neuron-1", expect.objectContaining({transaction: uploadTransaction}));
        });

        test("saves the hand-off file, records a pending attempt and starts quality control after the commit", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            const result = await upload(userWith(UserPermissions.Admin));

            expect(result).toBe(stubs.attempt);

            const qcTag = stubs.generateSkeleton.mock.calls[0][2].id;

            expect(stubs.writeUploadFile).toHaveBeenCalledWith({
                version: 1,
                qcTag,
                annotationId: "annotation-1",
                notes: "the notes",
                skeletonSource: `${skeletonBase}/precomputed/nmcp-qc-${qcTag}`,
                segmentId: 1,
                source: stubs.data.source,
                comments: stubs.data.comments,
                rows: simpleReconstruction.toReconstructionRows(stubs.data)
            });

            expect(stubs.create).toHaveBeenCalledWith({
                annotationId: "annotation-1",
                attemptNumber: 1,
                status: RawReconstructionUploadStatus.PendingQualityControl,
                userId: "user-1",
                sourceFilename: "neuron.swc",
                format: format,
                failureMessage: null,
                qcTag,
                skeletonId: 1
            }, {transaction: uploadTransaction});

            expect(stubs.writeUploadFile.mock.invocationCallOrder[0]).toBeLessThan(stubs.create.mock.invocationCallOrder[0]);
            expect(eventKinds(stubs.createEvent)).toEqual([EventLogItemKind.RawReconstructionUploadCreate]);
            expect(stubs.createEvent.mock.calls[0][1]).toEqual({transaction: uploadTransaction});

            expect(stubs.startQualityControl).toHaveBeenCalledTimes(1);
            expect(stubs.startQualityControl).toHaveBeenCalledWith("attempt-1");
            expect(stubs.committed.mock.invocationCallOrder[0]).toBeLessThan(stubs.startQualityControl.mock.invocationCallOrder[0]);

            expect(stubs.deleteForReplacement).not.toHaveBeenCalled();
            expect(stubs.createFromParsed).not.toHaveBeenCalled();
        });

        test("defaults omitted notes to an empty string", async () => {
            const stubs = setup(AnnotationStatus.InProgress);

            await upload(userWith(UserPermissions.Admin), uploadArgs({notes: undefined}));

            expect(stubs.writeUploadFile.mock.calls[0][0].notes).toBe("");
        });

        test("is numbered one past the newest, soft-deleted rows included", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {newest: {attemptNumber: 4}});

            await upload(userWith(UserPermissions.Admin));

            expect(stubs.findOne).toHaveBeenCalledWith(expect.objectContaining({
                where: {annotationId: "annotation-1"},
                order: [["attemptNumber", "DESC"]],
                paranoid: false,
                transaction: uploadTransaction
            }));

            expect(stubs.create.mock.calls[0][0].attemptNumber).toBe(5);
        });
    });

    describe("a failure that records an attempt", () => {
        function expectFailedAttempt(stubs: any, status: number, message: string, tagged: boolean) {
            const values = stubs.create.mock.calls[0][0];

            expect(values).toMatchObject({status, failureMessage: message});

            if (tagged) {
                expect(uuid.version(values.qcTag)).toBe(7);
                expect(values.skeletonId).toBe(1);
            } else {
                expect(values.qcTag).toBeNull();
                expect(values.skeletonId).toBeNull();
            }

            expect(stubs.create.mock.calls[0][1]).toEqual({transaction: uploadTransaction});
            expect(eventKinds(stubs.createEvent)).toEqual([EventLogItemKind.RawReconstructionUploadCreate, EventLogItemKind.RawReconstructionUploadFail]);
            expect(stubs.createEvent.mock.calls[1][0].details).toEqual({status, failureMessage: message});
            expect(stubs.startQualityControl).not.toHaveBeenCalled();
            expect(stubs.createFromParsed).not.toHaveBeenCalled();
        }

        test("a parse error is recorded as FailedUpload and rethrown, with no skeleton", async () => {
            const stubs = setup(AnnotationStatus.InProgress);
            const parseError = new Error("bad file");
            stubs[parser].mockRejectedValue(parseError);

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toBe(parseError);

            expectFailedAttempt(stubs, RawReconstructionUploadStatus.FailedUpload, "bad file", false);
            expect(stubs.generateSkeleton).not.toHaveBeenCalled();
            expect(stubs.writeUploadFile).not.toHaveBeenCalled();
            expect(stubs.committed).toHaveBeenCalledTimes(1);
        });

        test("a file with no soma is recorded as FailedUpload and rethrown", async () => {
            const stubs = setup(AnnotationStatus.InProgress, {data: reconstructionData({axonSoma: undefined, dendriteSoma: undefined})});

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toThrow("A soma was not found in the uploaded file.");

            expectFailedAttempt(stubs, RawReconstructionUploadStatus.FailedUpload, "A soma was not found in the uploaded file.", false);
            expect(stubs.generateSkeleton).not.toHaveBeenCalled();
        });

        test("a failure row that cannot be written does not mask the original error", async () => {
            const stubs = setup(AnnotationStatus.InProgress);
            const parseError = new Error("bad file");
            stubs[parser].mockRejectedValue(parseError);
            stubs.create.mockRejectedValue(new Error("insert failed"));

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toBe(parseError);

            expect(stubs.committed).not.toHaveBeenCalled();
        });

        test.each([
            ["unreachable", {serviceStatus: PrecomputedServiceStatus.Unavailable, errorKind: null, errorDescription: null, httpStatus: null},
                "The precomputed service could not be reached."],
            ["HTTP 500", {serviceStatus: PrecomputedServiceStatus.Error, errorKind: null, errorDescription: null, httpStatus: 500},
                "The precomputed service returned HTTP 500."],
            ["a generation error", {serviceStatus: PrecomputedServiceStatus.Error, errorKind: "GenerationError", errorDescription: "no nodes", httpStatus: null},
                "Skeleton generation failed (GenerationError): no nodes."],
            ["another reconstruction's result", {serviceStatus: PrecomputedServiceStatus.Error, errorKind: "ReconstructionIdMismatch", errorDescription: "the service answered for reconstruction other instead of tag", httpStatus: null},
                "Skeleton generation failed (ReconstructionIdMismatch): the service answered for reconstruction other instead of tag."]
        ])("a precomputed service that is %s records FailedPrecomputed and returns 1012", async (_label: string, result: any, message: string) => {
            const stubs = setup(AnnotationStatus.InProgress);
            stubs.generateSkeleton.mockResolvedValue(result);

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1012}});

            expectFailedAttempt(stubs, RawReconstructionUploadStatus.FailedPrecomputed, message, true);
            expect(stubs.create.mock.calls[0][0].qcTag).toBe(stubs.generateSkeleton.mock.calls[0][2].id);
            expect(stubs.writeUploadFile).not.toHaveBeenCalled();
        });

        test("a hand-off file that cannot be written records FailedQualityControlService and returns 1012", async () => {
            const stubs = setup(AnnotationStatus.InProgress);
            stubs.writeUploadFile.mockRejectedValue(new Error("ENOSPC"));

            await expect(upload(userWith(UserPermissions.Admin))).rejects.toMatchObject({extensions: {code: 1012}});

            expectFailedAttempt(stubs, RawReconstructionUploadStatus.FailedQualityControlService, "The upload could not be saved for quality control.", true);
        });
    });
});

describe("RawReconstructionUpload quality control", () => {
    const qcTag = "0196a2c4-0000-7000-8000-000000000001";

    function row(index: number, structure: number, parentIndex: number) {
        return {index, parentIndex, structure, x: index, y: index, z: index, radius: 1, atlasStructure: null};
    }

    function uploadFile() {
        return {
            version: 1,
            qcTag,
            annotationId: "annotation-1",
            notes: "the notes",
            skeletonSource: `${skeletonBase}/precomputed/nmcp-qc-${qcTag}`,
            segmentId: 1,
            source: "neuron.swc",
            comments: "# comment\n",
            rows: [row(1, 1, -1), row(2, 2, 1), row(3, 3, 1)]
        };
    }

    function envelope(overrides: object = {}) {
        return {
            serviceVersion: "3.0.3",
            standardMorphVersion: "1.0.3",
            reconstructionId: qcTag,
            qualityControl: {metrics: [{name: "non_empty", status_history: [{status: "Pass"}]}]},
            error: null,
            ...overrides
        };
    }

    function qcSuccess(body: any) {
        return {reconstructionId: qcTag, serviceStatus: QualityCheckServiceStatus.Success, serviceError: null, output: toQualityControlOutput(qcTag, body)};
    }

    type WorkerOptions = {
        locked?: any;
        lockedSequence?: any[];
        result?: any;
        uploader?: any;
    };

    function worker(options: WorkerOptions = {}) {
        vi.spyOn(NeuronStructure, "AxonStructureId", "get").mockReturnValue("ns-axon");
        vi.spyOn(NeuronStructure, "DendriteStructureId", "get").mockReturnValue("ns-dendrite");

        const committed = vi.fn();

        defineSequelize(RawReconstructionUpload, finishTransaction, committed);

        const attempt = attemptStub({status: RawReconstructionUploadStatus.PendingQualityControl, qcTag});
        const lockedSequence = options.lockedSequence ?? [];
        let lockedReads = 0;

        const findAttempt = vi.spyOn(RawReconstructionUpload, "findByPk").mockImplementation(async (_id: string, query: any) => {
            if (query?.transaction !== finishTransaction) {
                return attempt;
            }

            const next = lockedReads < lockedSequence.length ? lockedSequence[lockedReads] : ("locked" in options ? options.locked : attempt);

            lockedReads++;

            return next;
        });

        const findAnnotation = vi.spyOn(Annotation, "findByPk").mockResolvedValue(annotationStub(AnnotationStatus.InProgress));

        const uploader = "uploader" in options ? options.uploader : userWith(UserPermissions.AnnotateOne, "user-1");
        const findUser = vi.spyOn(User, "findByPk").mockResolvedValue(uploader);
        const internalUser = userWith(UserPermissions.Admin, "internal");
        vi.spyOn(User, "SystemInternalUser", "get").mockReturnValue(internalUser);

        const readUploadFile = vi.spyOn(files, "readUploadFile").mockResolvedValue(uploadFile());
        const publishDocument = vi.spyOn(files, "publishQualityControlDocument").mockResolvedValue(undefined);
        const removeDocument = vi.spyOn(files, "removeQualityControlDocument").mockResolvedValue(undefined);

        const performQualityCheck = vi.spyOn(QualityCheckService, "performQualityCheck").mockResolvedValue(options.result ?? qcSuccess(envelope()));

        const deleteForReplacement = vi.spyOn(RawReconstruction, "deleteForReplacement").mockResolvedValue("raw-old");
        const createFromParsed = vi.spyOn(RawReconstruction, "createFromParsed").mockResolvedValue({id: "raw-new"});
        const createEvent = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        const postToPortal = vi.spyOn(RawReconstructionUpload, "postQualityControlToMetadataPortal").mockResolvedValue(undefined);

        return {
            attempt, committed, uploader, internalUser,
            findAttempt, findAnnotation, findUser, readUploadFile, publishDocument, removeDocument, performQualityCheck,
            deleteForReplacement, createFromParsed, createEvent, postToPortal
        };
    }

    function expectOutcome(stubs: any, status: number, message: string | null) {
        expect(stubs.attempt.update).toHaveBeenLastCalledWith({status, failureMessage: message}, {transaction: finishTransaction});
    }

    function expectNoDocumentOutcome(stubs: any) {
        expect(stubs.publishDocument).not.toHaveBeenCalled();
        expect(stubs.removeDocument).toHaveBeenCalledWith(qcTag);
        expect(stubs.createFromParsed).not.toHaveBeenCalled();
        expect(stubs.postToPortal).not.toHaveBeenCalled();
    }

    test("checks the saved rows in image space against the saved skeleton", async () => {
        const stubs = worker();

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.readUploadFile).toHaveBeenCalledWith(qcTag);
        expect(stubs.performQualityCheck).toHaveBeenCalledWith(qcTag, simpleReconstruction.toNodeData(uploadFile().rows), {
            isRegistered: false,
            skeletonSource: `${skeletonBase}/precomputed/nmcp-qc-${qcTag}`,
            segmentIds: [1]
        });
    });

    test.each([
        ["Passed", envelope()],
        ["PassedWithWarnings", envelope({qualityControl: {metrics: [{name: "non_empty", status_history: [{status: "Pending"}]}]}})]
    ])("%s publishes the document, replaces the raw reconstruction and accepts", async (_label: string, body: any) => {
        const stubs = worker({result: qcSuccess(body)});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        const lockedAnnotation = stubs.findAnnotation.mock.calls.findIndex((call: any[]) => call[1]?.transaction === finishTransaction);
        const lockedAttempt = stubs.findAttempt.mock.calls.findIndex((call: any[]) => call[1]?.transaction === finishTransaction);

        expect(stubs.findAnnotation.mock.calls[lockedAnnotation]).toEqual(["annotation-1", {transaction: finishTransaction, lock: Transaction.LOCK.UPDATE}]);
        expect(stubs.findAttempt.mock.calls[lockedAttempt]).toEqual(["attempt-1", {transaction: finishTransaction, lock: Transaction.LOCK.UPDATE}]);
        expect(stubs.findAnnotation.mock.invocationCallOrder[lockedAnnotation]).toBeLessThan(stubs.findAttempt.mock.invocationCallOrder[lockedAttempt]);

        expect(stubs.publishDocument).toHaveBeenCalledWith(qcTag, body.qualityControl);
        expect(stubs.findAttempt.mock.invocationCallOrder[lockedAttempt]).toBeLessThan(stubs.publishDocument.mock.invocationCallOrder[0]);
        expect(stubs.publishDocument.mock.invocationCallOrder[0]).toBeLessThan(stubs.deleteForReplacement.mock.invocationCallOrder[0]);
        expect(stubs.removeDocument).not.toHaveBeenCalled();

        const file = uploadFile();

        expect(stubs.deleteForReplacement).toHaveBeenCalledWith("annotation-1", finishTransaction);
        expect(stubs.createFromParsed).toHaveBeenCalledWith(stubs.uploader, {
            annotationId: "annotation-1",
            uploadId: "attempt-1",
            notes: "the notes",
            supersededId: "raw-old"
        }, simpleReconstruction.buildSimpleReconstruction(file.source, file.rows, file.comments), expect.objectContaining({index: 1}), finishTransaction);
        expect(stubs.deleteForReplacement.mock.invocationCallOrder[0]).toBeLessThan(stubs.createFromParsed.mock.invocationCallOrder[0]);

        expectOutcome(stubs, RawReconstructionUploadStatus.Accepted, null);
        expect(eventKinds(stubs.createEvent)).toEqual([EventLogItemKind.RawReconstructionUploadAccept]);
        expect(stubs.createEvent.mock.calls[0][0].details).toBe("");
        expect(stubs.postToPortal).not.toHaveBeenCalled();
    });

    test("Failed publishes the document, keeps the raw reconstruction, and posts to the portal after the commit", async () => {
        const stubs = worker({result: qcSuccess(envelope({qualityControl: nmcpQcDocument}))});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        const reason = "quality control failed 2 metric(s): duplicate_node_coordinates, edge_length";

        expect(stubs.publishDocument).toHaveBeenCalledWith(qcTag, nmcpQcDocument);
        expect(stubs.publishDocument.mock.invocationCallOrder[0]).toBeLessThan(stubs.attempt.update.mock.invocationCallOrder[0]);
        expect(stubs.removeDocument).not.toHaveBeenCalled();
        expect(stubs.deleteForReplacement).not.toHaveBeenCalled();
        expect(stubs.createFromParsed).not.toHaveBeenCalled();

        expectOutcome(stubs, RawReconstructionUploadStatus.FailedQualityControl, reason);
        expect(stubs.createEvent.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.RawReconstructionUploadFail,
            details: {status: RawReconstructionUploadStatus.FailedQualityControl, failureMessage: reason}
        });

        expect(stubs.postToPortal).toHaveBeenCalledTimes(1);
        expect(stubs.postToPortal).toHaveBeenCalledWith(stubs.attempt, nmcpQcDocument, `${skeletonBase}/precomputed/nmcp-qc-${qcTag}`);
        expect(stubs.committed.mock.invocationCallOrder[0]).toBeLessThan(stubs.postToPortal.mock.invocationCallOrder[0]);
    });

    test.each([
        ["with another reconstruction's document", envelope({reconstructionId: "someone-else"})],
        ["without a document", envelope({qualityControl: null, error: {stage: "standard_morph", kind: "ValueError", description: "bad input", info: "trace"}})]
    ])("an Error score %s records ErroredQualityControl with no document", async (_label: string, body: any) => {
        const stubs = worker({result: qcSuccess(body)});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        const output = toQualityControlOutput(qcTag, body);

        expectOutcome(stubs, RawReconstructionUploadStatus.ErroredQualityControl,
            `quality control service error (${output.error.stage}, ${output.error.kind}): ${output.error.description}`);
        expectNoDocumentOutcome(stubs);
        expect(stubs.removeDocument.mock.invocationCallOrder[0]).toBeLessThan(stubs.attempt.update.mock.invocationCallOrder[0]);
    });

    test.each([
        ["unreachable", {reconstructionId: qcTag, serviceStatus: QualityCheckServiceStatus.Unavailable, serviceError: "ECONNREFUSED", output: null},
            "The quality control service could not be reached."],
        ["a non-OK response", {reconstructionId: qcTag, serviceStatus: QualityCheckServiceStatus.Error, serviceError: "502", output: null},
            "The quality control service returned HTTP 502."]
    ])("a quality control service that is %s records FailedQualityControlService", async (_label: string, result: any, message: string) => {
        const stubs = worker({result});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expectOutcome(stubs, RawReconstructionUploadStatus.FailedQualityControlService, message);
        expectNoDocumentOutcome(stubs);
    });

    test("a resumed attempt whose crashed run left a document has it removed before the service failure commits", async () => {
        const stubs = worker({result: {reconstructionId: qcTag, serviceStatus: QualityCheckServiceStatus.Unavailable, serviceError: "down", output: null}});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.removeDocument).toHaveBeenCalledWith(qcTag);
        expect(stubs.removeDocument.mock.invocationCallOrder[0]).toBeLessThan(stubs.attempt.update.mock.invocationCallOrder[0]);
    });

    test("an unreadable hand-off file records FailedQualityControlService without calling quality control", async () => {
        const stubs = worker();
        stubs.readUploadFile.mockRejectedValue(new Error("ENOENT"));

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.performQualityCheck).not.toHaveBeenCalled();
        expectOutcome(stubs, RawReconstructionUploadStatus.FailedQualityControlService, "The saved upload could not be read for quality control.");
        expectNoDocumentOutcome(stubs);
    });

    test("a hand-off file with no soma records FailedQualityControlService", async () => {
        const stubs = worker();
        stubs.readUploadFile.mockResolvedValue({...uploadFile(), rows: [row(2, 2, 1)]});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.performQualityCheck).not.toHaveBeenCalled();
        expectOutcome(stubs, RawReconstructionUploadStatus.FailedQualityControlService, "The saved upload could not be read for quality control.");
    });

    test.each([
        ["closed by a newer upload", () => attemptStub({status: RawReconstructionUploadStatus.FailedQualityControlService, qcTag})],
        ["discarded", () => null]
    ])("an attempt %s meanwhile is left alone, file included", async (_label: string, locked: () => any) => {
        const lockedAttempt = locked();
        const stubs = worker({locked: lockedAttempt});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.publishDocument).not.toHaveBeenCalled();
        expect(stubs.removeDocument).not.toHaveBeenCalled();
        expect(stubs.attempt.update).not.toHaveBeenCalled();
        expect(lockedAttempt?.update ?? vi.fn()).not.toHaveBeenCalled();
        expect(stubs.deleteForReplacement).not.toHaveBeenCalled();
        expect(stubs.createEvent).not.toHaveBeenCalled();
    });

    test("an attempt that is no longer pending when the run starts is not checked", async () => {
        const stubs = worker();
        stubs.attempt.status = RawReconstructionUploadStatus.Accepted;

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.readUploadFile).not.toHaveBeenCalled();
        expect(stubs.performQualityCheck).not.toHaveBeenCalled();
    });

    test("a document that cannot be published falls back to FailedQualityControlService with the document removed", async () => {
        const stubs = worker();
        stubs.publishDocument.mockRejectedValue(new Error("EACCES"));

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.createFromParsed).not.toHaveBeenCalled();
        expect(stubs.removeDocument).toHaveBeenCalledWith(qcTag);
        expect(stubs.attempt.update).toHaveBeenCalledTimes(1);
        expectOutcome(stubs, RawReconstructionUploadStatus.FailedQualityControlService, "Quality control could not be completed.");
    });

    describe("a failure after the document is published", () => {
        function expectFallback(stubs: any) {
            expect(stubs.publishDocument).toHaveBeenCalledTimes(1);
            expect(stubs.removeDocument).toHaveBeenCalledWith(qcTag);
            expect(stubs.publishDocument.mock.invocationCallOrder[0]).toBeLessThan(stubs.removeDocument.mock.invocationCallOrder[0]);
            expect(stubs.removeDocument.mock.invocationCallOrder[0]).toBeLessThan(stubs.attempt.update.mock.invocationCallOrder.at(-1));
            expectOutcome(stubs, RawReconstructionUploadStatus.FailedQualityControlService, "Quality control could not be completed.");
        }

        test("a replacement that fails falls back", async () => {
            const stubs = worker();
            stubs.createFromParsed.mockRejectedValueOnce(new Error("write failed"));

            await RawReconstructionUpload.runQualityControl("attempt-1");

            expectFallback(stubs);
        });

        test("an outcome write that fails falls back", async () => {
            const stubs = worker({result: qcSuccess(envelope({qualityControl: nmcpQcDocument}))});
            stubs.attempt.update.mockRejectedValueOnce(new Error("update failed"));

            await RawReconstructionUpload.runQualityControl("attempt-1");

            expectFallback(stubs);
            expect(stubs.postToPortal).not.toHaveBeenCalled();
        });

        test("a commit that fails falls back", async () => {
            const stubs = worker();
            const transaction = (RawReconstructionUpload as any).sequelize.transaction;
            transaction.mockImplementationOnce(async (callback: any) => {
                await callback(finishTransaction);
                throw new Error("commit failed");
            });

            await RawReconstructionUpload.runQualityControl("attempt-1");

            expectFallback(stubs);
        });

        test("a commit reported as failed that landed is left alone by the fallback", async () => {
            const accepted = attemptStub({status: RawReconstructionUploadStatus.Accepted, qcTag});
            const stubs = worker();
            stubs.findAttempt.mockImplementation(async (_id: string, query: any) => {
                if (query?.transaction !== finishTransaction) {
                    return stubs.attempt;
                }

                return stubs.findAttempt.mock.calls.filter((call: any[]) => call[1]?.transaction === finishTransaction).length == 1 ? stubs.attempt : accepted;
            });
            const transaction = (RawReconstructionUpload as any).sequelize.transaction;
            transaction.mockImplementationOnce(async (callback: any) => {
                await callback(finishTransaction);
                throw new Error("commit reported failed");
            });

            await RawReconstructionUpload.runQualityControl("attempt-1");

            expect(stubs.publishDocument).toHaveBeenCalledTimes(1);
            expect(stubs.removeDocument).not.toHaveBeenCalled();
            expect(stubs.attempt.update).toHaveBeenCalledTimes(1);
            expect(accepted.update).not.toHaveBeenCalled();
        });

        test("a fallback whose removal fails leaves the attempt pending, and nothing escapes", async () => {
            const stubs = worker();
            stubs.createFromParsed.mockRejectedValue(new Error("write failed"));
            stubs.removeDocument.mockRejectedValue(new Error("EACCES"));

            await expect(RawReconstructionUpload.startQualityControl("attempt-1")).resolves.toBeUndefined();

            expect(stubs.attempt.update).not.toHaveBeenCalled();
            expect(stubs.createEvent).not.toHaveBeenCalled();
        });
    });

    test("a missing uploader falls back to the internal system user", async () => {
        const stubs = worker({uploader: null});

        await RawReconstructionUpload.runQualityControl("attempt-1");

        expect(stubs.findUser).toHaveBeenCalledWith("user-1", {transaction: finishTransaction});
        expect(stubs.createFromParsed.mock.calls[0][0]).toBe(stubs.internalUser);
        expect(stubs.createEvent.mock.calls[0][0].userId).toBe("internal");
    });

    describe("starting and resuming", () => {
        test("one attempt is run once at a time, and released when the run settles", async () => {
            let release: () => void;
            const gate = new Promise<void>(resolve => release = resolve);
            const run = vi.spyOn(RawReconstructionUpload, "runQualityControl").mockImplementation(async () => {
                await gate;
                throw new Error("run failed");
            });

            const first = RawReconstructionUpload.startQualityControl("attempt-1");
            const second = RawReconstructionUpload.startQualityControl("attempt-1");

            await second;

            expect(run).toHaveBeenCalledTimes(1);

            release();

            await expect(first).resolves.toBeUndefined();

            run.mockResolvedValue(undefined);

            await RawReconstructionUpload.startQualityControl("attempt-1");

            expect(run).toHaveBeenCalledTimes(2);
        });

        test("resumes pending attempts whose hand-off file exists, and counts them", async () => {
            const pendingAttempts = [
                attemptStub({id: "attempt-a", qcTag: "tag-a"}),
                attemptStub({id: "attempt-b", qcTag: "tag-b"}),
                attemptStub({id: "attempt-c", qcTag: null})
            ];
            const findAll = vi.spyOn(RawReconstructionUpload, "findAll").mockResolvedValue(pendingAttempts);
            vi.spyOn(files, "uploadFileExists").mockImplementation(async (tag: string) => tag === "tag-a");
            const start = vi.spyOn(RawReconstructionUpload, "startQualityControl").mockResolvedValue(undefined);

            expect(await RawReconstructionUpload.resumeQualityControl()).toBe(1);

            expect(findAll).toHaveBeenCalledWith({where: {status: RawReconstructionUploadStatus.PendingQualityControl}});
            expect(start).toHaveBeenCalledTimes(1);
            expect(start).toHaveBeenCalledWith("attempt-a");
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

        await RawReconstructionUpload.discardForAnnotation("annotation-1", uploadTransaction);

        expect(destroy).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, transaction: uploadTransaction});
        expect((destroy.mock.calls[0][0] as any).force).toBeUndefined();
    });

    function sourceRow(values: object) {
        return {toJSON: () => ({...values})};
    }

    test("copyForRevision re-creates every attempt on the revision, keeping every other value, QC tag and skeleton id included", async () => {
        const createdAt = new Date("2026-11-01T10:00:00.000Z");
        const updatedAt = new Date("2026-11-01T10:05:00.000Z");

        const accepted = {
            id: "attempt-a", annotationId: "annotation-1", attemptNumber: 1, status: RawReconstructionUploadStatus.Accepted,
            userId: "user-1", sourceFilename: "a.swc", format: RawReconstructionUploadFormat.Swc, failureMessage: null,
            qcTag: "0196a2c4-0000-7000-8000-000000000001", skeletonId: 1,
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

        await RawReconstructionUpload.copyForRevision("annotation-1", "annotation-2", uploadTransaction);

        expect(findAll).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, order: [["attemptNumber", "ASC"]], transaction: uploadTransaction});
        expect(bulkCreate).toHaveBeenCalledTimes(1);

        const [copies, options]: any[] = bulkCreate.mock.calls[0];

        expect(options).toEqual({transaction: uploadTransaction});
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

        await RawReconstructionUpload.copyForRevision("annotation-1", "annotation-2", uploadTransaction);

        expect(bulkCreate).not.toHaveBeenCalled();
    });
});
