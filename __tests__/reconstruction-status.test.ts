import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {ClosedReconstructionStatuses, UntraceableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

// A numeric TS enum carries reverse mappings, so Object.keys is twice the member count.
const statusMemberCount = Object.keys(ReconstructionStatus).filter(key => isNaN(Number(key))).length;

describe("ClosedReconstructionStatuses", () => {
    test("contains exactly the statuses that release the annotator's slot", () => {
        expect([...ClosedReconstructionStatuses].sort()).toEqual([
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ].sort());
    });

    test("excludes every status that still holds the slot", () => {
        const stillOpen = [
            ReconstructionStatus.Initialized,
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing
        ];

        for (const status of stillOpen) {
            expect(ClosedReconstructionStatuses).not.toContain(status);
        }

        // Fails if a status is added to the enum without being classified either way.
        expect(stillOpen.length + ClosedReconstructionStatuses.length).toBe(statusMemberCount);
    });
});

describe("UntraceableSourceStatuses", () => {
    test("admits the statuses a reconstruction may be marked untraceable from", () => {
        expect([...UntraceableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.Initialized,
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.WaitingForAtlasReconstruction
        ].sort());
    });

    test("refuses every terminal status and the ones past review", () => {
        const refused = [
            ReconstructionStatus.Approved,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(UntraceableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + UntraceableSourceStatuses.length).toBe(statusMemberCount);
    });
});
