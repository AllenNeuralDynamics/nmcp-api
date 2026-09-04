import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

import type {ServiceBackoff} from "../src/synchronization/serviceBackoff";
import type {PhaseOutcome as PhaseOutcomeType} from "../src/util/phaseFailure";

// Use require() to get the CJS module instances the compiled worker uses, so that
// spying on QualityControl and resetting qcBackoff affect the same instances the
// worker calls into (a plain ESM import yields a separate instance under vitest).
const qualityControlModule = require("../src/models/qualityControl");
const workerModule = require("../src/synchronization/synchronizationWorker");
const {PhaseOutcome} = require("../src/util/phaseFailure");

const QualityControl: typeof import("../src/models/qualityControl").QualityControl =
    qualityControlModule.QualityControl;

const performQualityControl: (batchSize: number) => Promise<boolean> =
    workerModule.performQualityControl;

const qcBackoff: ServiceBackoff = workerModule.qcBackoff;

type AssessFn = () => Promise<PhaseOutcomeType>;

// claim/release as well as assess: the worker claims the row before it calls the phase, and hands the claim back
// from its catch.
const makePending = (assess: AssessFn) => ({
    id: "qc-1",
    assess,
    claim: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined)
} as unknown as InstanceType<typeof QualityControl>);

const makeBatch = (count: number, assess: AssessFn) =>
    Array.from({length: count}, () => makePending(assess));

describe("performQualityControl", () => {
    beforeEach(() => {
        // Reset any backoff state carried over from a prior test.
        qcBackoff.recordSuccess();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        qcBackoff.recordSuccess();
    });

    test("abandons the batch but reports the outstanding work when the service is unavailable", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.ServiceUnavailable);
        vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(10, assess));

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(true);
        expect(assess).toHaveBeenCalledTimes(1);
    });

    test("skips the service entirely while inside the backoff window", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.ServiceUnavailable);
        const getPending = vi
            .spyOn(QualityControl, "getPending")
            .mockResolvedValue(makeBatch(10, assess));

        await performQualityControl(10);
        expect(getPending).toHaveBeenCalledTimes(1);

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(false);
        expect(getPending).toHaveBeenCalledTimes(1);
    });

    test("retries the service once the backoff window elapses", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.ServiceUnavailable);
        const getPending = vi
            .spyOn(QualityControl, "getPending")
            .mockResolvedValue(makeBatch(10, assess));

        await performQualityControl(10);
        expect(getPending).toHaveBeenCalledTimes(1);

        vi.setSystemTime(60 * 1000);

        await performQualityControl(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    test("reports a full batch when every item succeeds", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.Handled);
        vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(10, assess));

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(true);
        expect(assess).toHaveBeenCalledTimes(10);
    });

    test("a partial successful batch does not drive the fast loop or engage backoff", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.Handled);
        const getPending = vi
            .spyOn(QualityControl, "getPending")
            .mockResolvedValue(makeBatch(3, assess));

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(false);
        expect(assess).toHaveBeenCalledTimes(3);

        // Not backed off: a subsequent pass still queries the service.
        await performQualityControl(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    // A database blip is not an outage of StandardMorph.  Released has to leave the backoff alone, or a Postgres
    // hiccup suppresses calls to a service that is answering perfectly well for up to five minutes.
    test("a released item does not engage the backoff or abandon the batch", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.Released);
        const getPending = vi
            .spyOn(QualityControl, "getPending")
            .mockResolvedValue(makeBatch(3, assess));

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(false);
        expect(assess).toHaveBeenCalledTimes(3);
        expect(qcBackoff.currentDelay).toBe(0);

        await performQualityControl(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    test("an item whose claim is lost is skipped without being assessed", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(PhaseOutcome.Handled);
        const batch = makeBatch(3, assess);

        (batch[1].claim as any).mockResolvedValue(false);

        vi.spyOn(QualityControl, "getPending").mockResolvedValue(batch);

        const mayBeMore = await performQualityControl(3);

        expect(assess).toHaveBeenCalledTimes(2);
        // Two of three dealt with, so not a full batch and no fast loop.
        expect(mayBeMore).toBe(false);
    });

    test("an item that throws has its claim handed back and the pass continues", async () => {
        const assess = vi.fn<AssessFn>()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValue(PhaseOutcome.Handled);

        const batch = makeBatch(3, assess);

        vi.spyOn(QualityControl, "getPending").mockResolvedValue(batch);

        await performQualityControl(3);

        expect(assess).toHaveBeenCalledTimes(3);
        expect(batch[0].release).toHaveBeenCalledTimes(1);
        expect(batch[1].release).not.toHaveBeenCalled();
    });

    // The release is a write, so it can fail for the same reason the failure record it follows failed.  The pass
    // must survive it; the sweep at the top of the next pass is what recovers the row.
    test("a release that itself rejects does not take the rest of the batch down", async () => {
        const assess = vi.fn<AssessFn>()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValue(PhaseOutcome.Handled);

        const batch = makeBatch(3, assess);

        (batch[0].release as any).mockRejectedValue(new Error("database is gone"));

        vi.spyOn(QualityControl, "getPending").mockResolvedValue(batch);

        await expect(performQualityControl(3)).resolves.toBe(false);

        expect(assess).toHaveBeenCalledTimes(3);
    });

    test("no pending items assesses nothing and does not report a full batch", async () => {
        const assess = vi.fn<AssessFn>();
        vi.spyOn(QualityControl, "getPending").mockResolvedValue([]);

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(false);
        expect(assess).not.toHaveBeenCalled();
    });
});
