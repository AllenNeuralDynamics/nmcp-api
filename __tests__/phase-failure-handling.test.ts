import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {ConnectionError, DatabaseError, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasNode} = require("../src/models/atlasNode");
const {Atlas} = require("../src/models/atlas");
const {QualityControl} = require("../src/models/qualityControl");
const {QualityControlStatus} = require("../src/models/qualityControlStatus");
const {PrecomputedStatus} = require("../src/models/precomputed");
const {EventLogItem} = require("../src/models/eventLogItem");
const {QualityCheckService, QualityCheckServiceStatus, QualityControlScore} = require("../src/data-access/qualityCheckService");
const {SearchIndexOperation} = require("../src/transform/searchIndexOperation");
const {SearchIndex} = require("../src/models/searchIndex");
const {PhaseOutcome} = require("../src/util/phaseFailure");

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
    for (const model of [AtlasReconstruction, QualityControl]) {
        delete (model as any).sequelize;
    }
});

describe("qualityControlChanged", () => {
    function child(status: number = AtlasReconstructionStatus.PendingQualityControl) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        return prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: status,
            failureReason: "a failure from the previous run",
            failedAt: new Date("2026-01-01")
        });
    }

    test("a pass advances to structure assignment and clears the previous failure", async () => {
        const atlasReconstruction = child();

        await atlasReconstruction.qualityControlChanged(QualityControlStatus.Passed, null, systemUser, transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingStructureAssignment);
        expect(atlasReconstruction.failureReason).toBeNull();
        expect(atlasReconstruction.failedAt).toBeNull();
    });

    test("a morphology failure records the reason it was handed", async () => {
        const atlasReconstruction = child();

        await atlasReconstruction.qualityControlChanged(
            QualityControlStatus.Failed,
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
            QualityControlStatus.Error,
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

        await atlasReconstruction.qualityControlChanged(QualityControlStatus.Passed, null, systemUser, transaction);

        expect(atlasReconstruction.status).toBe(AtlasReconstructionStatus.PendingStructureAssignment);
    });

    test("a child outside the quality control statuses writes nothing", async () => {
        const atlasReconstruction = child(AtlasReconstructionStatus.ReadyToPublish);

        await atlasReconstruction.qualityControlChanged(QualityControlStatus.Failed, "whatever", systemUser, transaction);

        expect(atlasReconstruction.update).not.toHaveBeenCalled();
    });
});

describe("QualityControl.assess outcomes", () => {
    function assessable(options: {reject?: any} = {}) {
        stubTransactions(QualityControl, AtlasReconstruction);

        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);
        vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any);

        const child = prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: AtlasReconstructionStatus.InQualityControl
        });

        const lockChild = vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(child);

        const performQualityCheck = vi.spyOn(QualityCheckService, "performQualityCheck");

        if (options.reject) {
            performQualityCheck.mockRejectedValue(options.reject);
        } else {
            performQualityCheck.mockResolvedValue({
                serviceStatus: QualityCheckServiceStatus.Success,
                output: {score: QualityControlScore.Passed, errors: [], warnings: [], passed: []}
            } as any);
        }

        const qualityControl = prototypeStub(QualityControl, {
            id: "qc-1",
            reconstructionId: "atlas-1",
            status: QualityControlStatus.InProgress,
            release: vi.fn().mockResolvedValue(undefined)
        });

        return {qualityControl, child, lockChild, performQualityCheck, staticUpdate: QualityControl.update};
    }

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

    // The path the end-to-end wrap exists for: performQualityCheck serializes the nodes before its own try, so a
    // database error there throws out of it rather than becoming Unavailable.
    test("a throw before any service result is recorded on both rows", async () => {
        const stubs = assessable({reject: new TypeError("cannot read soma")});

        expect(await stubs.qualityControl.assess(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.qualityControl.status).toBe(QualityControlStatus.Error);
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
    function assignable(options: {atlas?: any; rejectWith?: any} = {}) {
        stubTransactions(AtlasReconstruction);

        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);
        vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any);
        vi.spyOn(Atlas, "getAtlas").mockReturnValue("atlas" in options ? options.atlas : {findForLocation: () => "structure-1"});

        const count = vi.spyOn(AtlasNode, "count");

        if (options.rejectWith) {
            count.mockRejectedValue(options.rejectWith);
        } else {
            count.mockResolvedValue(0);
        }

        const nodeUpdate = vi.spyOn(AtlasNode, "update").mockResolvedValue([0] as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: AtlasReconstructionStatus.InStructureAssignment,
            getReconstruction: vi.fn().mockResolvedValue({Neuron: {Specimen: {atlasId: "atlas-id-1"}}}),
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

        const parent = prototypeStub(Reconstruction, {
            id: "reconstruction-1",
            status: options.parentStatus ?? ReconstructionStatus.Publishing,
            onAtlasReconstructionStatusChanged: vi.fn().mockResolvedValue(undefined)
        });

        const lockParent = vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(parent);

        const clearIndex = vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0 as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: AtlasReconstructionStatus.InSearchIndexing,
            failureReason: "a failure from the previous run",
            getReconstruction: vi.fn().mockResolvedValue(parent)
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

        expect(stubs.lockParent).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

        expect(stubs.parent.status).toBe(ReconstructionStatus.PublishFailed);
        expect(stubs.parent.update).toHaveBeenCalledWith({status: ReconstructionStatus.PublishFailed}, {transaction: transaction});

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

        expect(stubs.parent.status).toBe(ReconstructionStatus.Publishing);
        expect(stubs.parent.update).not.toHaveBeenCalled();
        expect(stubs.parent.onAtlasReconstructionStatusChanged).not.toHaveBeenCalled();
    });

    // The guard is in onSearchIndexFailed rather than at the call site, so a parent a publish or a replay has moved
    // since is logged and left alone rather than clobbered.  The child's failure still records.
    test("a parent found at some other status is left alone, and the child still fails", async () => {
        const stubs = indexable({rejectWith: new TypeError("no soma"), parentStatus: ReconstructionStatus.WaitingForAtlasReconstruction});

        expect(await stubs.atlasReconstruction.updateSearchIndex(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.parent.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
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
            reconstructionId: "reconstruction-1",
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
