import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {ClosedReconstructionStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

describe("ClosedReconstructionStatuses", () => {
    test("contains exactly the statuses that release the annotator's slot", () => {
        expect([...ClosedReconstructionStatuses].sort()).toEqual([
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
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
    });
});
