import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

import type {ServiceBackoff} from "../src/synchronization/serviceBackoff";

// Use require() to get the CJS module instances the compiled worker uses, so that spying on the models affects the
// same instances the worker calls into.  Requiring the worker does not start it: require.main !== module here, so
// the bootstrap timer never arms and no sweep runs on import.
const {Transaction} = require("sequelize");
const atlasReconstructionModule = require("../src/models/atlasReconstruction");
const qualityControlModule = require("../src/models/qualityControl");
const workerModule = require("../src/synchronization/synchronizationWorker");
const {AtlasReconstructionStatus, ClaimedPhaseStatuses} = require("../src/models/atlasReconstructionStatus");
const {QualityControlStatus} = require("../src/models/qualityControlStatus");
const {PhaseOutcome} = require("../src/util/phaseFailure");

const AtlasReconstruction = atlasReconstructionModule.AtlasReconstruction;
const QualityControl = qualityControlModule.QualityControl;

const performSynchronization: (repeat?: boolean, intervalSeconds?: number) => Promise<void> = workerModule.performSynchronization;
const performStructureAssignments: (batchSize: number) => Promise<boolean> = workerModule.performStructureAssignments;
const performSearchIndexing: (batchSize: number) => Promise<boolean> = workerModule.performSearchIndexing;
const releaseAbandonedClaims: () => Promise<void> = workerModule.releaseAbandonedClaims;

const qcBackoff: ServiceBackoff = workerModule.qcBackoff;
const doiBackoff: ServiceBackoff = workerModule.doiBackoff;

const transaction = {sentinel: "t"} as any;

// Each phase's status pair, the method the worker calls, and the selection it comes from - so the claim contract is
// asserted once per phase rather than once per phase per property.
const childPhases = [
    {
        name: "structure assignment",
        selector: "getPendingStructureAssignment",
        method: "calculateStructureAssignments",
        run: () => performStructureAssignments(3),
        pending: AtlasReconstructionStatus.PendingStructureAssignment,
        claimed: AtlasReconstructionStatus.InStructureAssignment
    },
    {
        name: "search indexing",
        selector: "getIndexable",
        method: "updateSearchIndex",
        run: () => performSearchIndexing(3),
        pending: AtlasReconstructionStatus.PendingSearchIndexing,
        claimed: AtlasReconstructionStatus.InSearchIndexing
    }
];

function makeItem(method: string, outcome: any) {
    const item: any = {
        id: "atlas-1",
        claim: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined)
    };

    item[method] = typeof outcome === "function" ? outcome : vi.fn().mockResolvedValue(outcome);

    return item;
}

beforeEach(() => {
    qcBackoff.recordSuccess();
    doiBackoff.recordSuccess();
});

afterEach(() => {
    vi.restoreAllMocks();
    qcBackoff.recordSuccess();
    doiBackoff.recordSuccess();
    delete (AtlasReconstruction as any).sequelize;
    delete (QualityControl as any).sequelize;
    delete (process as any).send;
});

describe.each(childPhases)("$name claims its item", (phase) => {
    test("claims with the phase's status pair before doing any work", async () => {
        const item = makeItem(phase.method, PhaseOutcome.Handled);

        vi.spyOn(AtlasReconstruction, phase.selector).mockResolvedValue([item]);

        await phase.run();

        expect(item.claim).toHaveBeenCalledWith(phase.pending, phase.claimed);
        expect(item.claim.mock.invocationCallOrder[0]).toBeLessThan(item[phase.method].mock.invocationCallOrder[0]);
    });

    test("skips an item whose claim is lost, without working it or counting it", async () => {
        const items = [makeItem(phase.method, PhaseOutcome.Handled), makeItem(phase.method, PhaseOutcome.Handled), makeItem(phase.method, PhaseOutcome.Handled)];

        items[1].claim.mockResolvedValue(false);

        vi.spyOn(AtlasReconstruction, phase.selector).mockResolvedValue(items);

        // Two of three dealt with, so not a full batch and no fast loop.
        expect(await phase.run()).toBe(false);
        expect(items[1][phase.method]).not.toHaveBeenCalled();
    });

    // Inside the per-item try, so a claim that fails on a transient costs one item rather than the whole phase.
    test("an item whose claim rejects costs only that item", async () => {
        const items = [makeItem(phase.method, PhaseOutcome.Handled), makeItem(phase.method, PhaseOutcome.Handled), makeItem(phase.method, PhaseOutcome.Handled)];

        items[0].claim.mockRejectedValue(new Error("deadlock"));

        vi.spyOn(AtlasReconstruction, phase.selector).mockResolvedValue(items);

        await phase.run();

        expect(items[1][phase.method]).toHaveBeenCalledTimes(1);
        expect(items[2][phase.method]).toHaveBeenCalledTimes(1);
    });

    test("a released item is not counted towards the batch", async () => {
        const items = [makeItem(phase.method, PhaseOutcome.Released), makeItem(phase.method, PhaseOutcome.Released), makeItem(phase.method, PhaseOutcome.Released)];

        vi.spyOn(AtlasReconstruction, phase.selector).mockResolvedValue(items);

        expect(await phase.run()).toBe(false);
    });

    test("a throw hands the claim back with the phase's own status pair", async () => {
        const items = [
            makeItem(phase.method, vi.fn().mockRejectedValue(new Error("the failure write failed"))),
            makeItem(phase.method, PhaseOutcome.Handled)
        ];

        vi.spyOn(AtlasReconstruction, phase.selector).mockResolvedValue(items);

        await phase.run();

        expect(items[0].release).toHaveBeenCalledWith(phase.claimed, phase.pending);
        expect(items[1].release).not.toHaveBeenCalled();
        // The pass continues past it.
        expect(items[1][phase.method]).toHaveBeenCalledTimes(1);
    });

    // The release is a write too, so it can fail for the same reason the failure record did.  What must not happen
    // is the release's own error replacing the diagnosis or taking the rest of the batch down.
    test("a release that itself rejects does not stop the batch", async () => {
        const items = [
            makeItem(phase.method, vi.fn().mockRejectedValue(new Error("the failure write failed"))),
            makeItem(phase.method, PhaseOutcome.Handled)
        ];

        items[0].release.mockRejectedValue(new Error("the database is gone"));

        vi.spyOn(AtlasReconstruction, phase.selector).mockResolvedValue(items);

        await expect(phase.run()).resolves.toBe(false);
        expect(items[1][phase.method]).toHaveBeenCalledTimes(1);
    });
});

describe("QualityControl claim and release", () => {
    function claimable(qualityControlStatus: number = QualityControlStatus.Pending, affected: number = 1) {
        const transactionFn = vi.fn().mockImplementation(async (callback: any) => await callback(transaction));

        Object.defineProperty(QualityControl, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});

        const lockChild = vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue({id: "atlas-1"} as any);
        const childUpdate = vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any);
        const rowUpdate = vi.spyOn(QualityControl, "update").mockResolvedValue([affected] as any);

        const qualityControl = Object.create(QualityControl.prototype);

        Object.assign(qualityControl, {id: "qc-1", reconstructionId: "atlas-1", status: qualityControlStatus});

        return {qualityControl, lockChild, childUpdate, rowUpdate};
    }

    // One lock order for every transaction over both rows.  requestReassessment locks the child then writes this
    // row; a claim that went the other way would deadlock against it.
    test("locks the atlas child before writing the quality control row", async () => {
        const stubs = claimable();

        expect(await stubs.qualityControl.claim()).toBe(true);

        expect(stubs.lockChild).toHaveBeenCalledWith("atlas-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
        expect(stubs.lockChild.mock.invocationCallOrder[0]).toBeLessThan(stubs.rowUpdate.mock.invocationCallOrder[0]);
    });

    test("a won claim moves both rows and the in-memory status", async () => {
        const stubs = claimable();

        await stubs.qualityControl.claim();

        expect(stubs.rowUpdate).toHaveBeenCalledWith(
            {status: QualityControlStatus.InProgress},
            {where: {id: "qc-1", status: QualityControlStatus.Pending}, transaction: transaction}
        );

        expect(stubs.childUpdate).toHaveBeenCalledWith(
            {status: AtlasReconstructionStatus.InQualityControl},
            {where: {id: "atlas-1", status: AtlasReconstructionStatus.PendingQualityControl}, transaction: transaction}
        );

        expect(stubs.qualityControl.status).toBe(QualityControlStatus.InProgress);
    });

    test("a lost compare-and-set claims neither row", async () => {
        const stubs = claimable(QualityControlStatus.Pending, 0);

        expect(await stubs.qualityControl.claim()).toBe(false);
        expect(stubs.childUpdate).not.toHaveBeenCalled();
    });

    test("release takes the child lock first as well", async () => {
        const stubs = claimable(QualityControlStatus.InProgress);

        await stubs.qualityControl.release();

        expect(stubs.lockChild.mock.invocationCallOrder[0]).toBeLessThan(stubs.rowUpdate.mock.invocationCallOrder[0]);
        expect(stubs.qualityControl.status).toBe(QualityControlStatus.Pending);
    });
});

describe("the pass-boundary sweep", () => {
    function sweepable(childrenReleased: number = 0, qualityControlReleased: number = 0) {
        return {
            childSweep: vi.spyOn(AtlasReconstruction, "releasePhaseClaims").mockResolvedValue(childrenReleased),
            qualityControlSweep: vi.spyOn(QualityControl, "releasePhaseClaims").mockResolvedValue(qualityControlReleased)
        };
    }

    function stubEmptyPhases() {
        return {
            getPending: vi.spyOn(QualityControl, "getPending").mockResolvedValue([]),
            getPendingStructureAssignment: vi.spyOn(AtlasReconstruction, "getPendingStructureAssignment").mockResolvedValue([]),
            getPendingDoiAssignment: vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue([]),
            getIndexable: vi.spyOn(AtlasReconstruction, "getIndexable").mockResolvedValue([])
        };
    }

    test("covers both tables and reports what it released", async () => {
        const stubs = sweepable(2, 1);

        await releaseAbandonedClaims();

        expect(stubs.childSweep).toHaveBeenCalledTimes(1);
        expect(stubs.qualityControlSweep).toHaveBeenCalledTimes(1);
    });

    test("runs before the first phase of every pass, not just the first", async () => {
        const sweep = sweepable();
        const phases = stubEmptyPhases();

        await performSynchronization(false);

        expect(sweep.childSweep).toHaveBeenCalledTimes(1);
        expect(sweep.childSweep.mock.invocationCallOrder[0]).toBeLessThan(phases.getPending.mock.invocationCallOrder[0]);

        await performSynchronization(false);

        expect(sweep.childSweep).toHaveBeenCalledTimes(2);
    });

    // Contained by its own try rather than by runPhase, which has no "may be more work" answer to give it.
    test("a sweep that throws does not cost the pass its phases", async () => {
        vi.spyOn(AtlasReconstruction, "releasePhaseClaims").mockRejectedValue(new Error("the database is gone"));
        vi.spyOn(QualityControl, "releasePhaseClaims").mockResolvedValue(0);

        const phases = stubEmptyPhases();

        await performSynchronization(false);

        for (const selection of Object.values(phases)) {
            expect(selection).toHaveBeenCalledTimes(1);
        }
    });

    /**
     * The end of the recovery chain: an item whose failure record fails *and* whose release fails is left claimed by
     * a worker that stays alive, so only a recurring sweep gets it back.  A startup-only sweep would have left it
     * stranded for the life of the process.
     */
    test("recovers an item whose failure write and release both failed", async () => {
        const item = makeItem("updateSearchIndex", vi.fn().mockRejectedValue(new Error("the failure write failed")));

        item.release.mockRejectedValue(new Error("the database is gone"));

        const sweep = sweepable();

        vi.spyOn(QualityControl, "getPending").mockResolvedValue([]);
        vi.spyOn(AtlasReconstruction, "getPendingStructureAssignment").mockResolvedValue([]);
        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue([]);
        const getIndexable = vi.spyOn(AtlasReconstruction, "getIndexable").mockResolvedValue([item]);

        await performSynchronization(false);

        // The row is still claimed at the end of that pass: nothing local could write the release.
        expect(item.release).toHaveBeenCalledTimes(1);

        getIndexable.mockResolvedValue([]);
        sweep.childSweep.mockResolvedValue(1);

        await performSynchronization(false);

        expect(sweep.childSweep).toHaveBeenCalledTimes(2);
    });

    // InPrecomputed is in flight in the precomputed service, not this worker, and registration is a manual upload.
    test("the sweep covers exactly the four worker claims", () => {
        expect([...ClaimedPhaseStatuses.keys()]).toEqual([
            AtlasReconstructionStatus.InQualityControl,
            AtlasReconstructionStatus.InStructureAssignment,
            AtlasReconstructionStatus.InDoiAssignment,
            AtlasReconstructionStatus.InSearchIndexing
        ]);

        expect(ClaimedPhaseStatuses.has(AtlasReconstructionStatus.InPrecomputed)).toBe(false);
        expect(ClaimedPhaseStatuses.has(AtlasReconstructionStatus.InRegistration)).toBe(false);

        for (const [claimed, pending] of ClaimedPhaseStatuses) {
            // Each claim returns to the pending status of the same phase, 20 lower in the enum.
            expect(claimed - pending).toBeLessThanOrEqual(20);
            expect(claimed).toBeGreaterThan(pending);
        }
    });
});
