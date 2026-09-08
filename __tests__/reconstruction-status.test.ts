import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {
    ClosedReconstructionStatuses,
    UntraceableSourceStatuses,
    ReviewRequestSourceStatuses,
    PausableSourceStatuses,
    DiscardableSourceStatuses,
    AdminDiscardableSourceStatuses,
    ApprovalSourceStatuses,
    PublishedCandidateBlockingStatuses,
    CandidateBlockingStatuses
} = require("../src/models/reconstruction");
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
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Rejected
        ].sort());
    });

    test("refuses the review pipeline onwards and every terminal status", () => {
        const refused = [
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
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

describe("ReviewRequestSourceStatuses", () => {
    test("admits the statuses a review may be requested from", () => {
        expect([...ReviewRequestSourceStatuses].sort()).toEqual([
            ReconstructionStatus.InProgress,
            ReconstructionStatus.Rejected
        ].sort());
    });

    test("refuses a paused reconstruction, the review pipeline and every terminal status", () => {
        const refused = [
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(ReviewRequestSourceStatuses).not.toContain(status);
        }

        expect(refused.length + ReviewRequestSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("PausableSourceStatuses", () => {
    test("admits the statuses a reconstruction may be paused from", () => {
        expect([...PausableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.InProgress,
            ReconstructionStatus.Rejected
        ].sort());
    });

    test("refuses an already paused reconstruction, the review pipeline and every terminal status", () => {
        const refused = [
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(PausableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + PausableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("DiscardableSourceStatuses", () => {
    test("admits the statuses an annotator may discard from", () => {
        expect([...DiscardableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Rejected
        ].sort());
    });

    test("refuses the review pipeline onwards and every terminal status", () => {
        const refused = [
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(DiscardableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + DiscardableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("AdminDiscardableSourceStatuses", () => {
    test("admits only the two review statuses", () => {
        expect([...AdminDiscardableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview
        ].sort());
    });

    test("refuses everything an annotator may discard from and everything from Approved onwards", () => {
        const refused = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(AdminDiscardableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + AdminDiscardableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("ApprovalSourceStatuses", () => {
    test("maps each approval target onto the status it must come from", () => {
        expect(ApprovalSourceStatuses.get(ReconstructionStatus.PublishReview)).toBe(ReconstructionStatus.PeerReview);
        expect(ApprovalSourceStatuses.get(ReconstructionStatus.Approved)).toBe(ReconstructionStatus.PublishReview);
    });

    test("no other status is an approval target", () => {
        const notATarget = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of notATarget) {
            expect(ApprovalSourceStatuses.get(status)).toBeUndefined();
        }

        expect(notATarget.length + ApprovalSourceStatuses.size).toBe(statusMemberCount);
    });
});

describe("PublishedCandidateBlockingStatuses", () => {
    test("admits a finished publication and one in transition to it", () => {
        expect([...PublishedCandidateBlockingStatuses].sort()).toEqual([
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published
        ].sort());
    });

    test("admits nothing else, so live work leaves the neuron a candidate", () => {
        const notBlocking = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of notBlocking) {
            expect(PublishedCandidateBlockingStatuses).not.toContain(status);
        }

        expect(notBlocking.length + PublishedCandidateBlockingStatuses.length).toBe(statusMemberCount);
    });
});

describe("CandidateBlockingStatuses", () => {
    test("admits every status where a reconstruction holds its neuron", () => {
        expect([...CandidateBlockingStatuses].sort()).toEqual([
            ReconstructionStatus.InProgress,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published
        ].sort());
    });

    test("releases the neuron when paused, archived or soft-deleted", () => {
        const released = [
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ];

        for (const status of released) {
            expect(CandidateBlockingStatuses).not.toContain(status);
        }

        expect(released.length + CandidateBlockingStatuses.length).toBe(statusMemberCount);
    });

    test("is a superset of the published-only list", () => {
        for (const status of PublishedCandidateBlockingStatuses) {
            expect(CandidateBlockingStatuses).toContain(status);
        }
    });
});
