import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {ConnectionError, DatabaseError, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {Annotation} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {AtlasNode} = require("../src/models/atlasNode");
const {Atlas} = require("../src/models/atlas");
const {AtlasQualityControl} = require("../src/models/atlasQualityControl");
const {AtlasQualityControlStatus} = require("../src/models/atlasQualityControlStatus");
const {PrecomputedStatus} = require("../src/models/precomputed");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {QualityCheckService, QualityCheckServiceStatus, QualityControlScore, toQualityControlOutput} = require("../src/data-access/qualityCheckService");
const nmcpQcDocument = require("./fixtures/nmcp-qc-document.json");
const {SearchIndexOperation} = require("../src/transform/searchIndexOperation");
const {SearchIndex} = require("../src/models/searchIndex");
const {PhaseOutcome, failureText} = require("../src/util/phaseFailure");

const transaction = {sentinel: "t"} as any;

const systemUser = (() => {
    const user = Object.create(User.prototype);
    user.id = "system-1";
    user.permissions = UserPermissions.InternalSystem;
    return user;
})();

function updateMock(instance: any) {
    return vi.fn().mockImplementation(async (update: any) => {
        Object.assign(instance, update);
        return instance;
    });
}

function prototypeStub(model: any, properties: object = {}) {
    const instance = Object.create(model.prototype);
    Object.assign(instance, {id: "instance-1"}, properties);
    instance.update = updateMock(instance);
    return instance;
}

function stubTransactions(...models: any[]) {
    const transactionFn = vi.fn().mockImplementation(async (callback: any) => await callback(transaction));

    for (const model of models) {
        Object.defineProperty(model, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});
    }

    return transactionFn;
}

// A rolled-back-and-try-again error rather than a broken item: 40P01 is deadlock_detected, which two siblings
// locking the same neuron row can genuinely produce.
const deadlock = () => {
    const error = new DatabaseError(new Error("deadlock detected"));
    (error as any).original = {code: "40P01"};
    return error;
};

// The whole point of the debug/column split: nothing that could carry a path, a table name or SQL.
const carriesNoStack = (reason: string) => {
    expect(reason).not.toContain("at ");
    expect(reason).not.toContain("__tests__");
    expect(reason).not.toContain("/src/");
};

afterEach(() => {
    vi.restoreAllMocks();
    for (const model of [AtlasReconstruction, AtlasQualityControl]) {
        delete (model as any).sequelize;
    }
});

describe("qualityControlChanged", () => {
    function child(status: number = AtlasReconstructionStatus.PendingQualityControl) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        return prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            annotationId: "annotation-1",
            status: status,
            failureReason: "a failure from the previous run",
            failedAt: new Date("2026-01-01")
        });
    }

    test("a pass advances to structure assignment and clears the previous failure", async () => {
        const atlasReconstruction = child();

        await atlasReconstruction.qualityControlChanged(AtlasQualityControlStatus.Passed, null, systemUser, transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingStructureAssignment);
        expect(atlasReconstruction.failureReason).toBeNull();
        expect(atlasReconstruction.failedAt).toBeNull();
    });

    test("a morphology failure records the reason it was handed", async () => {
        const atlasReconstruction = child();

        await atlasReconstruction.qualityControlChanged(
            AtlasQualityControlStatus.Failed,
            "quality control failed 2 test(s): SomaCount, Bifurcations",
            systemUser,
            transaction
        );

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedQualityControl);
        expect(atlasReconstruction.failureReason).toContain("SomaCount");
        expect(atlasReconstruction.failedAt).toBeInstanceOf(Date);
    });

    // B2: both outcomes halt at the same status, so the reason is the only thing that says which.
    test("a tool error records a reason distinguishable from a morphology failure", async () => {
        const atlasReconstruction = child();

        await atlasReconstruction.qualityControlChanged(
            AtlasQualityControlStatus.Error,
            "quality control tool error (SegmentationFault): the tool crashed",
            systemUser,
            transaction
        );

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedQualityControl);
        expect(atlasReconstruction.failureReason).toContain("tool error");
        expect(atlasReconstruction.failureReason).toContain("SegmentationFault");
    });

    test("a claimed child is admitted, since InQualityControl is one of the phase's statuses", async () => {
        const atlasReconstruction = child(AtlasReconstructionStatus.InQualityControl);

        await atlasReconstruction.qualityControlChanged(AtlasQualityControlStatus.Passed, null, systemUser, transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingStructureAssignment);
    });

    test("a child outside the quality control statuses writes nothing", async () => {
        const atlasReconstruction = child(AtlasReconstructionStatus.ReadyToPublish);

        await atlasReconstruction.qualityControlChanged(AtlasQualityControlStatus.Failed, "whatever", systemUser, transaction);

        expect(atlasReconstruction.update).not.toHaveBeenCalled();
    });
});

describe("AtlasQualityControl.assess outcomes", () => {
    const nodes = [{index: 1, structure: 1, x: 0, y: 0, z: 0, radius: 1, parentIndex: -1}];

    const metric = (name: string, ...statuses: string[]) => ({name, status_history: statuses.map(status => ({status}))});

    function serviceOutput(overrides: object = {}) {
        return toQualityControlOutput("atlas-1", {
            serviceVersion: "3.0.3",
            standardMorphVersion: "1.0.3",
            reconstructionId: "atlas-1",
            qualityControl: {metrics: [metric("non_empty", "Pass")]},
            error: null,
            ...overrides
        });
    }

    function assessable(options: {reject?: any, output?: any, current?: any} = {}) {
        stubTransactions(AtlasQualityControl, AtlasReconstruction);

        const createEvent = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);
        vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any);

        const child = prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            annotationId: "annotation-1",
            status: AtlasReconstructionStatus.InQualityControl
        });

        const lockChild = vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(child);

        // assess serializes the nodes itself now, so this is where a database error or a null soma comes from.
        const serializeNodes = vi.spyOn(AtlasReconstruction, "serializeNodes");

        if (options.reject) {
            serializeNodes.mockRejectedValue(options.reject);
        } else {
            serializeNodes.mockResolvedValue(nodes);
        }

        const output = options.output ?? serviceOutput();

        const performQualityCheck = vi.spyOn(QualityCheckService, "performQualityCheck").mockResolvedValue({
            reconstructionId: "atlas-1",
            serviceStatus: QualityCheckServiceStatus.Success,
            serviceError: null,
            output: output
        } as any);

        const qualityControl = prototypeStub(AtlasQualityControl, {
            id: "qc-1",
            reconstructionId: "atlas-1",
            status: AtlasQualityControlStatus.InProgress,
            current: options.current ?? null,
            history: null,
            release: vi.fn().mockResolvedValue(undefined)
        });

        return {qualityControl, child, lockChild, serializeNodes, performQualityCheck, createEvent, output, staticUpdate: AtlasQualityControl.update};
    }

    test("serializes the atlas nodes and checks them as registered", async () => {
        const stubs = assessable();

        await stubs.qualityControl.assess(systemUser);

        expect(stubs.serializeNodes).toHaveBeenCalledWith(User.SystemInternalUser, "atlas-1");
        expect(stubs.performQualityCheck).toHaveBeenCalledWith("atlas-1", nodes, {isRegistered: true});
    });

    test("a failed document names its failing metrics on the child", async () => {
        const stubs = assessable({output: serviceOutput({qualityControl: nmcpQcDocument})});

        expect(await stubs.qualityControl.assess(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.qualityControl.status).toBe(AtlasQualityControlStatus.Failed);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedQualityControl);
        expect(stubs.child.failureReason).toBe("quality control failed 2 metric(s): duplicate_node_coordinates, edge_length");
    });

    test("a service error records its stage, kind and description but not its info", async () => {
        const stubs = assessable({
            output: serviceOutput({
                qualityControl: null,
                error: {stage: "standard_morph", kind: "ValueError", description: "d", info: "secret detail"}
            })
        });

        await stubs.qualityControl.assess(systemUser);

        expect(stubs.qualityControl.status).toBe(AtlasQualityControlStatus.Error);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedQualityControl);
        expect(stubs.child.failureReason).toBe("quality control service error (standard_morph, ValueError): d");
        expect(stubs.child.failureReason).not.toContain("secret detail");
    });

    test("an id mismatch is recorded as a service error naming both ids", async () => {
        const stubs = assessable({output: serviceOutput({reconstructionId: "atlas-2"})});

        await stubs.qualityControl.assess(systemUser);

        expect(stubs.qualityControl.status).toBe(AtlasQualityControlStatus.Error);
        expect(stubs.child.failureReason).toContain("ReconstructionIdMismatch");
        expect(stubs.child.failureReason).toContain("atlas-1");
        expect(stubs.child.failureReason).toContain("atlas-2");
    });

    test("pending metrics without a failure pass and advance the child", async () => {
        const stubs = assessable({output: serviceOutput({qualityControl: {metrics: [metric("a", "Pass"), metric("b", "Pending")]}})});

        expect(stubs.output.score).toBe(QualityControlScore.PassedWithWarnings);

        await stubs.qualityControl.assess(systemUser);

        expect(stubs.qualityControl.status).toBe(AtlasQualityControlStatus.Passed);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingStructureAssignment);
        expect(stubs.child.failureReason).toBeNull();
    });

    test("the assessment event carries only the status and the output's common fields", async () => {
        const stubs = assessable();

        await stubs.qualityControl.assess(systemUser);

        const assessment = stubs.createEvent.mock.calls
            .map(call => call[0] as any)
            .find(item => item.kind === EventLogItemKind.AtlasQualityControlPassed);

        expect(Object.keys(assessment.details).sort()).toEqual(["serviceVersion", "status", "toolVersion", "when"]);
        expect(assessment.details).toEqual({
            status: AtlasQualityControlStatus.Passed,
            serviceVersion: stubs.output.serviceVersion,
            toolVersion: "1.0.3",
            when: stubs.output.when
        });
    });

    test("the row stores the full output and moves the previous one to history", async () => {
        const previous = {serviceVersion: 2, toolVersion: "0.0.1", when: "2026-01-01T00:00:00.000Z", errors: []};

        const stubs = assessable({current: previous});

        await stubs.qualityControl.assess(systemUser);

        expect(stubs.qualityControl.current).toBe(stubs.output);
        expect(stubs.qualityControl.history).toEqual([previous]);
    });

    test.each([
        ["unavailable", QualityCheckServiceStatus.Unavailable],
        ["erroring", QualityCheckServiceStatus.Error]
    ])("an %s service releases the claim and reports the service, not the item", async (_label: string, serviceStatus: number) => {
        const stubs = assessable();

        stubs.performQualityCheck.mockResolvedValue({serviceStatus: serviceStatus, output: null} as any);

        expect(await stubs.qualityControl.assess(systemUser)).toBe(PhaseOutcome.ServiceUnavailable);

        expect(stubs.qualityControl.release).toHaveBeenCalledTimes(1);
        expect(stubs.qualityControl.update).not.toHaveBeenCalled();
        expect(stubs.child.update).not.toHaveBeenCalled();
    });

    // The path the end-to-end wrap exists for: assess serializes the nodes inside its own try, so a database error
    // there is classified rather than escaping with the claim held.
    test("a throw before any service result is recorded on both rows", async () => {
        const stubs = assessable({reject: new TypeError("cannot read soma")});

        expect(await stubs.qualityControl.assess(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.qualityControl.status).toBe(AtlasQualityControlStatus.Error);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedQualityControl);
        expect(stubs.child.failureReason).toBe("unexpected TypeError during quality control");
        carriesNoStack(stubs.child.failureReason);
    });

    test.each([
        ["a connection error", () => new ConnectionError(new Error("connect refused"))],
        ["a deadlock", deadlock]
    ])("%s releases the claim and records no failure", async (_label: string, makeError: () => any) => {
        const stubs = assessable({reject: makeError()});

        expect(await stubs.qualityControl.assess(systemUser)).toBe(PhaseOutcome.Released);

        expect(stubs.qualityControl.release).toHaveBeenCalledTimes(1);
        expect(stubs.child.update).not.toHaveBeenCalled();
    });

    // One lock order for every transaction over both rows, so a claim and a reassessment cannot deadlock.
    test("the child is locked before this row is written, on both the success and the failure path", async () => {
        for (const options of [{}, {reject: new TypeError("boom")}]) {
            vi.clearAllMocks();

            const stubs = assessable(options);

            await stubs.qualityControl.assess(systemUser);

            expect(stubs.lockChild).toHaveBeenCalledWith("atlas-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

            expect(stubs.lockChild.mock.invocationCallOrder[0])
                .toBeLessThan(stubs.qualityControl.update.mock.invocationCallOrder[0]);
        }
    });
});

describe("calculateStructureAssignments failures", () => {
    function assignable(options: {atlas?: any; rejectWith?: any; count?: number} = {}) {
        stubTransactions(AtlasReconstruction);

        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);
        vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any);
        vi.spyOn(Atlas, "getAtlas").mockReturnValue("atlas" in options ? options.atlas : {findForLocation: () => "structure-1"});

        const count = vi.spyOn(AtlasNode, "count");

        if (options.rejectWith) {
            count.mockRejectedValue(options.rejectWith);
        } else {
            count.mockResolvedValue(options.count ?? 0);
        }

        const nodeUpdate = vi.spyOn(AtlasNode, "update").mockResolvedValue([0] as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            annotationId: "annotation-1",
            status: AtlasReconstructionStatus.InStructureAssignment,
            getAnnotation: vi.fn().mockResolvedValue({Neuron: {Specimen: {atlasId: "atlas-id-1"}}}),
            getPrecomputed: vi.fn().mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)})
        });

        return {atlasReconstruction, nodeUpdate};
    }

    // The TODO the phase used to carry: a missing atlas threw one line later with nothing recorded.
    test("a missing atlas is recorded against the item rather than thrown", async () => {
        const stubs = assignable({atlas: undefined});

        expect(await stubs.atlasReconstruction.calculateStructureAssignments(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedStructureAssignment);
        expect(stubs.atlasReconstruction.failureReason).toBe("no atlas is loaded for specimen atlas atlas-id-1");
        expect(stubs.nodeUpdate).not.toHaveBeenCalled();
    });

    test.each([
        ["an atlas with no spatial volume", null],
        ["an empty spatialUrl", ""]
    ])("%s fails the item when nodes need assigning", async (_label: string, spatialUrl: string) => {
        const atlas = {spatialUrl, findForLocation: vi.fn()};

        const stubs = assignable({atlas, count: 3});

        expect(await stubs.atlasReconstruction.calculateStructureAssignments(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedStructureAssignment);
        expect(stubs.atlasReconstruction.failureReason).toBe("no spatial volume is configured for specimen atlas atlas-id-1");
        expect(stubs.nodeUpdate).not.toHaveBeenCalled();
        expect(atlas.findForLocation).not.toHaveBeenCalled();
    });

    test("with every node already assigned, a missing volume is not a failure", async () => {
        const stubs = assignable({atlas: {spatialUrl: null, findForLocation: vi.fn()}, count: 0});

        expect(await stubs.atlasReconstruction.calculateStructureAssignments(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingPrecomputed);
    });

    test("a non-transient throw is recorded as a failure of this item", async () => {
        const stubs = assignable({rejectWith: new RangeError("index out of range")});

        expect(await stubs.atlasReconstruction.calculateStructureAssignments(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedStructureAssignment);
        expect(stubs.atlasReconstruction.failureReason).toBe("unexpected RangeError during structure assignment");
        carriesNoStack(stubs.atlasReconstruction.failureReason);
    });

    test.each([
        ["a connection error", () => new ConnectionError(new Error("connect refused"))],
        ["a deadlock", deadlock]
    ])("%s releases the claim instead", async (_label: string, makeError: () => any) => {
        const stubs = assignable({rejectWith: makeError()});

        expect(await stubs.atlasReconstruction.calculateStructureAssignments(systemUser)).toBe(PhaseOutcome.Released);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingStructureAssignment);
        expect(stubs.atlasReconstruction.failureReason).toBeUndefined();
    });

    test("a successful pass advances to precomputed and clears the columns", async () => {
        const stubs = assignable();

        stubs.atlasReconstruction.failureReason = "a failure from the previous run";

        expect(await stubs.atlasReconstruction.calculateStructureAssignments(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingPrecomputed);
        expect(stubs.atlasReconstruction.failureReason).toBeNull();
        expect(stubs.atlasReconstruction.failedAt).toBeNull();
    });
});

describe("updateSearchIndex failures", () => {
    // The parent is a real prototype instance rather than a bag of mocks, so onSearchIndexFailed's own status guard is
    // what these exercise; findByPk is what the failure hook reads it through, under the failure transaction.
    function indexable(options: {rejectWith?: any; parentStatus?: number} = {}) {
        stubTransactions(AtlasReconstruction);

        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);
        vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any);

        const process = vi.spyOn(SearchIndexOperation.prototype, "process");

        if (options.rejectWith) {
            process.mockRejectedValue(options.rejectWith);
        } else {
            process.mockResolvedValue(undefined);
        }

        const parent = prototypeStub(Annotation, {
            id: "annotation-1",
            status: options.parentStatus ?? AnnotationStatus.Publishing,
            onAtlasReconstructionStatusChanged: vi.fn().mockResolvedValue(undefined)
        });

        const lockParent = vi.spyOn(Annotation, "findByPk").mockResolvedValue(parent);

        const clearIndex = vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0 as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            annotationId: "annotation-1",
            status: AtlasReconstructionStatus.InSearchIndexing,
            failureReason: "a failure from the previous run",
            getAnnotation: vi.fn().mockResolvedValue(parent)
        });

        return {atlasReconstruction, parent, lockParent, clearIndex};
    }

    test("indexing that cannot succeed for this item is recorded and queryable", async () => {
        const stubs = indexable({rejectWith: new TypeError("no soma")});

        expect(await stubs.atlasReconstruction.updateSearchIndex(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedSearchIndexing);
        expect(stubs.atlasReconstruction.failureReason).toBe("unexpected TypeError during search indexing");
        carriesNoStack(stubs.atlasReconstruction.failureReason);
    });

    // Recovery is forward-only: the predecessor stays archived and the DOIs stand.  What moves is the parent status,
    // so the stuck reconstruction is distinguishable from one indexing normally.
    test("a failed item moves the parent to PublishFailed in the same transaction as the child's failure", async () => {
        const stubs = indexable({rejectWith: new TypeError("no soma")});

        await stubs.atlasReconstruction.updateSearchIndex(systemUser);

        expect(stubs.lockParent).toHaveBeenCalledWith("annotation-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

        expect(stubs.parent.status).toBe(AnnotationStatus.PublishFailed);
        expect(stubs.parent.update).toHaveBeenCalledWith({status: AnnotationStatus.PublishFailed}, {transaction: transaction});

        // Child first, then parent - the one lock order, and both writes in the one failure transaction.
        expect(stubs.atlasReconstruction.update.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.parent.update.mock.invocationCallOrder[0]);

        expect(stubs.parent.onAtlasReconstructionStatusChanged).not.toHaveBeenCalled();
    });

    // The invariant every route out of PublishFailed depends on: no search index rows for this reconstruction from the
    // moment the failure is recorded.  Keyed on the child's id, which is what SearchIndex.reconstructionId holds.
    test("a failed item clears its search index rows in the failure transaction", async () => {
        const stubs = indexable({rejectWith: new TypeError("no soma")});

        await stubs.atlasReconstruction.updateSearchIndex(systemUser);

        expect(stubs.clearIndex).toHaveBeenCalledWith({where: {reconstructionId: "atlas-1"}, transaction: transaction});
    });

    // A released claim is retried on the next pass, so there is nothing for a person to see and nothing to move.
    test("a transient leaves the parent untouched", async () => {
        const stubs = indexable({rejectWith: new ConnectionError(new Error("connect refused"))});

        await stubs.atlasReconstruction.updateSearchIndex(systemUser);

        expect(stubs.parent.status).toBe(AnnotationStatus.Publishing);
        expect(stubs.parent.update).not.toHaveBeenCalled();
        expect(stubs.parent.onAtlasReconstructionStatusChanged).not.toHaveBeenCalled();
    });

    // The guard is in onSearchIndexFailed rather than at the call site, so a parent a publish or a replay has moved
    // since is logged and left alone rather than clobbered.  The child's failure still records.
    test("a parent found at some other status is left alone, and the child still fails", async () => {
        const stubs = indexable({rejectWith: new TypeError("no soma"), parentStatus: AnnotationStatus.WaitingForAtlasReconstruction});

        expect(await stubs.atlasReconstruction.updateSearchIndex(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.parent.status).toBe(AnnotationStatus.WaitingForAtlasReconstruction);
        expect(stubs.parent.update).not.toHaveBeenCalled();

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedSearchIndexing);
    });

    test("a transient releases the claim and records no failure", async () => {
        const stubs = indexable({rejectWith: new ConnectionError(new Error("connect refused"))});

        expect(await stubs.atlasReconstruction.updateSearchIndex(systemUser)).toBe(PhaseOutcome.Released);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingSearchIndexing);
    });

    test("a successful index publishes, clears the columns and notifies the parent", async () => {
        const stubs = indexable();

        expect(await stubs.atlasReconstruction.updateSearchIndex(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.atlasReconstruction.status).toBe(AtlasReconstructionStatus.Published);
        expect(stubs.atlasReconstruction.failureReason).toBeNull();
        expect(stubs.atlasReconstruction.failedAt).toBeNull();

        expect(stubs.parent.onAtlasReconstructionStatusChanged)
            .toHaveBeenCalledWith(systemUser, AtlasReconstructionStatus.Published, transaction);
    });
});

describe("precomputedChanged failure kinds", () => {
    function child() {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        return prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            annotationId: "annotation-1",
            status: AtlasReconstructionStatus.PendingPrecomputed,
            failureReason: "a failure from the previous run",
            failedAt: new Date("2026-01-01")
        });
    }

    // The generation status survives instead of being collapsed to a boolean, which is what makes the two failure
    // kinds distinguishable on the child.
    test.each([
        ["FailedToLoad", PrecomputedStatus.FailedToLoad],
        ["FailedToGenerate", PrecomputedStatus.FailedToGenerate]
    ])("%s is named in the recorded reason", async (name: string, status: number) => {
        const atlasReconstruction = child();

        await atlasReconstruction.precomputedChanged(systemUser, status, transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.FailedPrecomputed);
        expect(atlasReconstruction.failureReason).toBe(`precomputed generation failed (${name})`);
        expect(atlasReconstruction.failedAt).toBeInstanceOf(Date);
    });

    test("completion advances to DOI assignment and clears the columns", async () => {
        const atlasReconstruction = child();

        await atlasReconstruction.precomputedChanged(systemUser, PrecomputedStatus.Complete, transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);
        expect(atlasReconstruction.failureReason).toBeNull();
        expect(atlasReconstruction.failedAt).toBeNull();
    });
});

describe("failureText", () => {
    test("names a database error's message and statement, which Sequelize leaves out of its stack", () => {
        const parent = Object.assign(new Error("column \"annotationId\" does not exist"), {sql: "SELECT \"annotationId\" FROM \"AtlasReconstruction\";"});
        const stack = "Error\n    at Query.run (query.js:50:25)";
        const error = new DatabaseError(parent, {stack: stack});

        const lines = failureText(error).split("\n");

        expect(lines[0]).toBe("SequelizeDatabaseError: column \"annotationId\" does not exist");
        expect(lines[1]).toBe("    sql: SELECT \"annotationId\" FROM \"AtlasReconstruction\";");
        expect(lines[2]).toBe("    at Query.run (query.js:50:25)");
    });

    test("leaves an ordinary error's stack as it is", () => {
        const error = new Error("plain failure");

        expect(failureText(error)).toBe(error.stack);
    });

    test("renders a non-error value as a string", () => {
        expect(failureText("plain value")).toBe("plain value");
    });
});
