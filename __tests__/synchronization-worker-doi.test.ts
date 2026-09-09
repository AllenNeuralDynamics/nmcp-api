import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

import type {ServiceBackoff} from "../src/synchronization/serviceBackoff";

// Use require() to get the CJS module instances the compiled worker uses, so that spying on AtlasReconstruction and
// resetting doiBackoff affect the same instances the worker calls into (a plain ESM import yields a separate
// instance under vitest).
const atlasReconstructionModule = require("../src/models/atlasReconstruction");
const workerModule = require("../src/synchronization/synchronizationWorker");

const AtlasReconstruction: typeof import("../src/models/atlasReconstruction").AtlasReconstruction =
    atlasReconstructionModule.AtlasReconstruction;

const performDoiAssignment: (batchSize: number) => Promise<boolean> = workerModule.performDoiAssignment;

const doiBackoff: ServiceBackoff = workerModule.doiBackoff;

type AssignFn = () => Promise<boolean>;

const makePending = (assignDois: AssignFn) => ({assignDois} as unknown as InstanceType<typeof AtlasReconstruction>);

const makeBatch = (count: number, assignDois: AssignFn) =>
    Array.from({length: count}, () => makePending(assignDois));

describe("performDoiAssignment", () => {
    beforeEach(() => {
        doiBackoff.recordSuccess();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        doiBackoff.recordSuccess();
    });

    test("abandons the batch but reports the outstanding work when the service is unavailable", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(false);
        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue(makeBatch(10, assignDois));

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(true);
        expect(assignDois).toHaveBeenCalledTimes(1);
    });

    test("skips the service entirely while inside the backoff window", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(false);
        const getPending = vi
            .spyOn(AtlasReconstruction, "getPendingDoiAssignment")
            .mockResolvedValue(makeBatch(10, assignDois));

        await performDoiAssignment(10);
        expect(getPending).toHaveBeenCalledTimes(1);

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(false);
        expect(getPending).toHaveBeenCalledTimes(1);
    });

    test("retries the service once the backoff window elapses", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const assignDois = vi.fn<AssignFn>().mockResolvedValue(false);
        const getPending = vi
            .spyOn(AtlasReconstruction, "getPendingDoiAssignment")
            .mockResolvedValue(makeBatch(10, assignDois));

        await performDoiAssignment(10);
        expect(getPending).toHaveBeenCalledTimes(1);

        vi.setSystemTime(60 * 1000);

        await performDoiAssignment(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    test("reports a full batch when every item is dealt with", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(true);
        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue(makeBatch(10, assignDois));

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(true);
        expect(assignDois).toHaveBeenCalledTimes(10);
    });

    test("a partial successful batch does not drive the fast loop or engage backoff", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(true);
        const getPending = vi
            .spyOn(AtlasReconstruction, "getPendingDoiAssignment")
            .mockResolvedValue(makeBatch(3, assignDois));

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(false);
        expect(assignDois).toHaveBeenCalledTimes(3);

        // Not backed off: a subsequent pass still queries the service.
        await performDoiAssignment(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    test("an item that throws is skipped and the pass continues without engaging the backoff", async () => {
        const assignDois = vi.fn<AssignFn>()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValue(true);

        const getPending = vi
            .spyOn(AtlasReconstruction, "getPendingDoiAssignment")
            .mockResolvedValue(makeBatch(3, assignDois));

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(false);
        expect(assignDois).toHaveBeenCalledTimes(3);
        expect(doiBackoff.currentDelay).toBe(0);

        await performDoiAssignment(10);
        expect(getPending).toHaveBeenCalledTimes(2);
    });

    test("no pending items registers nothing and does not report a full batch", async () => {
        const assignDois = vi.fn<AssignFn>();
        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue([]);

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(false);
        expect(assignDois).not.toHaveBeenCalled();
    });
});
