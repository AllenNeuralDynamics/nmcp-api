import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

import type {ServiceBackoff} from "../src/synchronization/serviceBackoff";

// Use require() to get the CJS module instances the compiled worker uses, so that
// spying on QualityControl and resetting qcBackoff affect the same instances the
// worker calls into (a plain ESM import yields a separate instance under vitest).
const qualityControlModule = require("../src/models/qualityControl");
const workerModule = require("../src/synchronization/synchronizationWorker");

const QualityControl: typeof import("../src/models/qualityControl").QualityControl =
    qualityControlModule.QualityControl;

const performQualityControl: (batchSize: number) => Promise<boolean> =
    workerModule.performQualityControl;

const qcBackoff: ServiceBackoff = workerModule.qcBackoff;

type AssessFn = () => Promise<boolean>;

const makePending = (assess: AssessFn) => ({assess} as unknown as InstanceType<typeof QualityControl>);

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

    test("does not report a full batch when the service is unavailable", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(false);
        vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(10, assess));

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(false);
        expect(assess).toHaveBeenCalledTimes(1);
    });

    test("skips the service entirely while inside the backoff window", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(false);
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

        const assess = vi.fn<AssessFn>().mockResolvedValue(false);
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
        const assess = vi.fn<AssessFn>().mockResolvedValue(true);
        vi.spyOn(QualityControl, "getPending").mockResolvedValue(makeBatch(10, assess));

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(true);
        expect(assess).toHaveBeenCalledTimes(10);
    });

    test("a partial successful batch does not drive the fast loop or engage backoff", async () => {
        const assess = vi.fn<AssessFn>().mockResolvedValue(true);
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

    test("no pending items assesses nothing and does not report a full batch", async () => {
        const assess = vi.fn<AssessFn>();
        vi.spyOn(QualityControl, "getPending").mockResolvedValue([]);

        const mayBeMore = await performQualityControl(10);

        expect(mayBeMore).toBe(false);
        expect(assess).not.toHaveBeenCalled();
    });
});
