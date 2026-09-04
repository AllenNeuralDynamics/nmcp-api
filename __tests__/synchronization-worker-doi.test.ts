import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

import type {ServiceBackoff} from "../src/synchronization/serviceBackoff";
import type {PhaseOutcome as PhaseOutcomeType} from "../src/util/phaseFailure";

// Use require() to get the CJS module instances the compiled worker uses, so that spying on AtlasReconstruction and
// resetting doiBackoff affect the same instances the worker calls into (a plain ESM import yields a separate
// instance under vitest).
const atlasReconstructionModule = require("../src/models/atlasReconstruction");
const workerModule = require("../src/synchronization/synchronizationWorker");
const {PhaseOutcome} = require("../src/util/phaseFailure");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");

const AtlasReconstruction: typeof import("../src/models/atlasReconstruction").AtlasReconstruction =
    atlasReconstructionModule.AtlasReconstruction;

const performDoiAssignment: (batchSize: number) => Promise<boolean> = workerModule.performDoiAssignment;

const doiBackoff: ServiceBackoff = workerModule.doiBackoff;

type AssignFn = () => Promise<PhaseOutcomeType>;

// claim/release as well as assignDois: the worker claims the row before calling the phase and hands the claim
// back from its catch.
const makePending = (assignDois: AssignFn) => ({
    id: "atlas-1",
    assignDois,
    claim: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined)
} as unknown as InstanceType<typeof AtlasReconstruction>);

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
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.ServiceUnavailable);
        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue(makeBatch(10, assignDois));

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(true);
        expect(assignDois).toHaveBeenCalledTimes(1);
    });

    test("skips the service entirely while inside the backoff window", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.ServiceUnavailable);
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

        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.ServiceUnavailable);
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
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.Handled);
        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue(makeBatch(10, assignDois));

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(true);
        expect(assignDois).toHaveBeenCalledTimes(10);
    });

    test("a partial successful batch does not drive the fast loop or engage backoff", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.Handled);
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

    // A database blip is not a DataCite outage.  Released must leave the backoff alone.
    test("a released item does not engage the backoff or abandon the batch", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.Released);

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

    test("an item whose claim is lost is skipped without being assigned", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.Handled);
        const batch = makeBatch(3, assignDois);

        (batch[1].claim as any).mockResolvedValue(false);

        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue(batch);

        expect(await performDoiAssignment(3)).toBe(false);
        expect(assignDois).toHaveBeenCalledTimes(2);
    });

    test("the claim is taken with the DOI status pair before the phase runs", async () => {
        const assignDois = vi.fn<AssignFn>().mockResolvedValue(PhaseOutcome.Handled);
        const batch = makeBatch(1, assignDois);

        vi.spyOn(AtlasReconstruction, "getPendingDoiAssignment").mockResolvedValue(batch);

        await performDoiAssignment(1);

        expect(batch[0].claim).toHaveBeenCalledWith(
            AtlasReconstructionStatus.PendingDoiAssignment,
            AtlasReconstructionStatus.InDoiAssignment
        );

        expect((batch[0].claim as any).mock.invocationCallOrder[0])
            .toBeLessThan(assignDois.mock.invocationCallOrder[0]);
    });

    test("an item that throws is skipped and the pass continues without engaging the backoff", async () => {
        const assignDois = vi.fn<AssignFn>()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValue(PhaseOutcome.Handled);

        const batch = makeBatch(3, assignDois);

        const getPending = vi
            .spyOn(AtlasReconstruction, "getPendingDoiAssignment")
            .mockResolvedValue(batch);

        const mayBeMore = await performDoiAssignment(10);

        expect(mayBeMore).toBe(false);
        expect(assignDois).toHaveBeenCalledTimes(3);
        expect(doiBackoff.currentDelay).toBe(0);

        // The claim goes back rather than stranding the row at InDoiAssignment, where nothing would select it and
        // requestDoiAssignment would refuse it.
        expect(batch[0].release).toHaveBeenCalledWith(
            AtlasReconstructionStatus.InDoiAssignment,
            AtlasReconstructionStatus.PendingDoiAssignment
        );
        expect(batch[1].release).not.toHaveBeenCalled();

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
