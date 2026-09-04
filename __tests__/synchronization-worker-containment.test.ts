import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

import type {ServiceBackoff} from "../src/synchronization/serviceBackoff";

// Use require() to get the CJS module instances the compiled worker uses, so that spying on the models and
// resetting qcBackoff affect the same instances the worker calls into (a plain ESM import yields a separate
// instance under vitest).  Requiring the worker does not start it: require.main !== module here, so the
// bootstrap timer never arms.
const qualityControlModule = require("../src/models/qualityControl");
const atlasReconstructionModule = require("../src/models/atlasReconstruction");
const workerModule = require("../src/synchronization/synchronizationWorker");
const {SynchronizationWorkerNotification} = require("../src/synchronization/synchonizationManager");

const QualityControl = qualityControlModule.QualityControl;
const AtlasReconstruction = atlasReconstructionModule.AtlasReconstruction;

const performSynchronization: (repeat?: boolean, intervalSeconds?: number) => Promise<void> =
    workerModule.performSynchronization;

const performQualityControl: (batchSize: number) => Promise<boolean> = workerModule.performQualityControl;
const performStructureAssignments: (batchSize: number) => Promise<boolean> = workerModule.performStructureAssignments;
const performSearchIndexing: (batchSize: number) => Promise<boolean> = workerModule.performSearchIndexing;

const qcBackoff: ServiceBackoff = workerModule.qcBackoff;

// makeBatch hands the same function to every item, so an "item 1 of 3 fails" fixture is one mock with ordered
// outcomes and the assertion is on its total call count.
const makeBatch = (count: number, fn: any) =>
    Array.from({length: count}, (_unused, idx) => ({id: `item-${idx}`, assess: fn, calculateStructureAssignments: fn, updateSearchIndex: fn}));

const failsOnce = () => vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(true);
const alwaysFails = () => vi.fn().mockRejectedValue(new Error("boom"));
const alwaysSucceeds = () => vi.fn().mockResolvedValue(true);

function stubPhases(qc: any[], structure: any[], indexable: any[]) {
    return {
        getPending: vi.spyOn(QualityControl, "getPending").mockResolvedValue(qc),
        getPendingStructureAssignment: vi.spyOn(AtlasReconstruction, "getPendingStructureAssignment").mockResolvedValue(structure),
        getIndexable: vi.spyOn(AtlasReconstruction, "getIndexable").mockResolvedValue(indexable)
    };
}

beforeEach(() => {
    // performSynchronization runs the QC phase, so backoff state carries between tests in this file.
    qcBackoff.recordSuccess();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    qcBackoff.recordSuccess();
    delete (process as any).send;
});

describe("performQualityControl containment", () => {
    test("a throwing item is skipped and the rest of the batch still runs", async () => {
        const assess = failsOnce();
        const getPending = vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(3, assess));

        const mayBeMore = await performQualityControl(10);

        expect(assess).toHaveBeenCalledTimes(3);
        expect(mayBeMore).toBe(false);

        // A throw is not a service-availability signal, so the backoff must not have engaged.
        await performQualityControl(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    test("a full batch of successes still reports more work", async () => {
        vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(3, alwaysSucceeds()));

        expect(await performQualityControl(3)).toBe(true);
    });

    test("a batch in which everything throws does not engage the backoff", async () => {
        vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(3, alwaysFails()));

        expect(await performQualityControl(3)).toBe(false);
        expect(qcBackoff.currentDelay).toBe(0);
    });
});

describe("performStructureAssignments containment", () => {
    test("a throwing item is skipped and the rest of the batch still runs", async () => {
        const calculate = failsOnce();
        vi.spyOn(AtlasReconstruction, "getPendingStructureAssignment").mockResolvedValue(makeBatch(3, calculate));

        const mayBeMore = await performStructureAssignments(10);

        expect(calculate).toHaveBeenCalledTimes(3);
        expect(mayBeMore).toBe(false);
    });

    test("a full batch of successes still reports more work", async () => {
        vi.spyOn(AtlasReconstruction, "getPendingStructureAssignment").mockResolvedValue(makeBatch(3, alwaysSucceeds()));

        expect(await performStructureAssignments(3)).toBe(true);
    });

    test("a batch in which everything throws does not drive the fast loop", async () => {
        vi.spyOn(AtlasReconstruction, "getPendingStructureAssignment").mockResolvedValue(makeBatch(3, alwaysFails()));

        expect(await performStructureAssignments(3)).toBe(false);
    });
});

describe("performSearchIndexing containment", () => {
    test("a throwing item is skipped and the rest of the batch still runs", async () => {
        const updateSearchIndex = failsOnce();
        vi.spyOn(AtlasReconstruction, "getIndexable").mockResolvedValue(makeBatch(3, updateSearchIndex));

        const mayBeMore = await performSearchIndexing(10);

        expect(updateSearchIndex).toHaveBeenCalledTimes(3);
        expect(mayBeMore).toBe(false);
    });

    test("a batch in which everything throws does not notify the main process", async () => {
        (process as any).send = vi.fn();

        vi.spyOn(AtlasReconstruction, "getIndexable").mockResolvedValue(makeBatch(3, alwaysFails()));

        expect(await performSearchIndexing(3)).toBe(false);
        expect((process as any).send).not.toHaveBeenCalled();
    });

    test("a batch with successes notifies the main process once", async () => {
        (process as any).send = vi.fn();

        vi.spyOn(AtlasReconstruction, "getIndexable").mockResolvedValue(makeBatch(3, alwaysSucceeds()));

        expect(await performSearchIndexing(3)).toBe(true);
        expect((process as any).send).toHaveBeenCalledTimes(1);
        expect((process as any).send).toHaveBeenCalledWith(SynchronizationWorkerNotification.SearchIndexUpdated);
    });
});

describe("performSynchronization phase isolation", () => {
    test("a failing quality control phase does not stop the later phases", async () => {
        const stubs = stubPhases([], [], []);
        stubs.getPending.mockRejectedValue(new Error("boom"));

        await performSynchronization(false);

        expect(stubs.getPendingStructureAssignment).toHaveBeenCalledTimes(1);
        expect(stubs.getIndexable).toHaveBeenCalledTimes(1);
    });

    test("a failing structure assignment phase does not stop the others", async () => {
        const stubs = stubPhases([], [], []);
        stubs.getPendingStructureAssignment.mockRejectedValue(new Error("boom"));

        await performSynchronization(false);

        expect(stubs.getPending).toHaveBeenCalledTimes(1);
        expect(stubs.getIndexable).toHaveBeenCalledTimes(1);
    });

    test("a pass in which every phase fails still resolves", async () => {
        const stubs = stubPhases([], [], []);
        stubs.getPending.mockRejectedValue(new Error("boom"));
        stubs.getPendingStructureAssignment.mockRejectedValue(new Error("boom"));
        stubs.getIndexable.mockRejectedValue(new Error("boom"));

        await expect(performSynchronization(false)).resolves.toBeUndefined();
    });
});

describe("performSynchronization rescheduling", () => {
    // Mocking the implementation is what stops the recursion; advancing fake timers would re-enter the pass.
    const stubTimer = () => vi.spyOn(globalThis, "setTimeout").mockImplementation((() => 0) as any);

    test("reschedules exactly once when every phase fails", async () => {
        const timeout = stubTimer();

        const stubs = stubPhases([], [], []);
        stubs.getPending.mockRejectedValue(new Error("boom"));
        stubs.getPendingStructureAssignment.mockRejectedValue(new Error("boom"));
        stubs.getIndexable.mockRejectedValue(new Error("boom"));

        await performSynchronization(true);

        expect(timeout).toHaveBeenCalledTimes(1);
    });

    test("a wholly failed pass waits the full interval rather than fast-looping", async () => {
        const timeout = stubTimer();

        const stubs = stubPhases([], [], []);
        stubs.getPending.mockRejectedValue(new Error("boom"));
        stubs.getPendingStructureAssignment.mockRejectedValue(new Error("boom"));
        stubs.getIndexable.mockRejectedValue(new Error("boom"));

        await performSynchronization(true);

        expect(timeout.mock.calls[0][1]).toBeGreaterThan(50);
    });

    test("a full batch still drives the fast loop", async () => {
        const timeout = stubTimer();

        stubPhases(makeBatch(10, alwaysSucceeds()), [], []);

        await performSynchronization(true, 60);

        expect(timeout.mock.calls[0][1]).toBe(50);
    });
});
