import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {
    ClosedReconstructionStatuses,
    AnnotationLimitExemptStatuses,
    UntraceableSourceStatuses,
    ReviewRequestSourceStatuses,
    PausableSourceStatuses,
    ResumableSourceStatuses,
    DiscardableSourceStatuses,
    AdminDiscardableSourceStatuses,
    ApprovalSourceStatuses,
    PublishedCandidateBlockingStatuses,
    CandidateBlockingStatuses
} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

// A numeric TS enum carries reverse mappings, so Object.keys is twice the member count.
const statusMemberCount = Object.keys(ReconstructionStatus).filter(key => isNaN(Number(key))).length;

describe("ReconstructionStatus hold values", () => {
    // The client mirrors these numbers.
    test("Incomplete is 210", () => {
        expect(ReconstructionStatus.Incomplete).toBe(210);
    });

    test("Duplicate is 220", () => {
        expect(ReconstructionStatus.Duplicate).toBe(220);
    });
});

describe("ClosedReconstructionStatuses", () => {
    test("contains exactly the closed statuses", () => {
        expect([...ClosedReconstructionStatuses].sort()).toEqual([
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded
        ].sort());
    });

    test("excludes every status at which a reconstruction is still open", () => {
        const stillOpen = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.PublishFailed
        ];

        for (const status of stillOpen) {
            expect(ClosedReconstructionStatuses).not.toContain(status);
        }

        // Fails if a status is added to the enum without being classified either way.
        expect(stillOpen.length + ClosedReconstructionStatuses.length).toBe(statusMemberCount);
    });
});

describe("AnnotationLimitExemptStatuses", () => {
    test("contains exactly the closed statuses plus Incomplete and Duplicate", () => {
        expect([...AnnotationLimitExemptStatuses].sort()).toEqual([
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Discarded,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate
        ].sort());
    });

    test("contains every closed status", () => {
        for (const status of ClosedReconstructionStatuses) {
            expect(AnnotationLimitExemptStatuses).toContain(status);
        }
    });

    test("excludes every status that still holds the slot", () => {
        const stillCounting = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.PublishFailed
        ];

        for (const status of stillCounting) {
            expect(AnnotationLimitExemptStatuses).not.toContain(status);
        }

        expect(stillCounting.length + AnnotationLimitExemptStatuses.length).toBe(statusMemberCount);
    });
});

describe("UntraceableSourceStatuses", () => {
    test("admits the statuses a reconstruction may be marked untraceable from", () => {
        expect([...UntraceableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.Rejected
        ].sort());
    });

    test("refuses the review pipeline onwards and every terminal status", () => {
        const refused = [
            ReconstructionStatus.PeerReview,
            // Decided, not overlooked: a team reviewer who finds a neuron untraceable rejects it, and the annotator
            // marks it untraceable from Rejected.  See User.canMarkReconstructionUntraceable.
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
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

    test("refuses a held reconstruction, the review pipeline and every terminal status", () => {
        const refused = [
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
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

    test("refuses an already held reconstruction, the review pipeline and every terminal status", () => {
        const refused = [
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(PausableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + PausableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("ResumableSourceStatuses", () => {
    test("admits exactly the three hold statuses", () => {
        expect([...ResumableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate
        ].sort());
    });

    test("refuses every status that is not a hold", () => {
        const refused = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(ResumableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + ResumableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("DiscardableSourceStatuses", () => {
    test("admits the statuses an annotator may discard from", () => {
        expect([...DiscardableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.Rejected
        ].sort());
    });

    test("refuses the review pipeline onwards and every terminal status", () => {
        const refused = [
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(DiscardableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + DiscardableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("AdminDiscardableSourceStatuses", () => {
    test("admits only the three review statuses", () => {
        expect([...AdminDiscardableSourceStatuses].sort()).toEqual([
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview
        ].sort());
    });

    test("refuses everything an annotator may discard from and everything from Approved onwards", () => {
        const refused = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Discarded
        ];

        for (const status of refused) {
            expect(AdminDiscardableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + AdminDiscardableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("ApprovalSourceStatuses", () => {
    test("maps each approval target onto the statuses it may come from", () => {
        expect(ApprovalSourceStatuses.get(ReconstructionStatus.TeamReview)).toEqual([ReconstructionStatus.PeerReview]);

        // Team review is optional, so the publish-review target has two sources.
        expect(ApprovalSourceStatuses.get(ReconstructionStatus.PublishReview)).toEqual([ReconstructionStatus.PeerReview, ReconstructionStatus.TeamReview]);

        expect(ApprovalSourceStatuses.get(ReconstructionStatus.Approved)).toEqual([ReconstructionStatus.PublishReview]);
    });

    test("no other status is an approval target", () => {
        const notATarget = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.Published,
            ReconstructionStatus.Archived,
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Discarded
        ];

        for (const status of notATarget) {
            expect(ApprovalSourceStatuses.get(status)).toBeUndefined();
        }

        expect(notATarget.length + ApprovalSourceStatuses.size).toBe(statusMemberCount);
    });
});

describe("PublishedCandidateBlockingStatuses", () => {
    test("admits a finished publication, one in transition to it, and one whose transition stalled", () => {
        expect([...PublishedCandidateBlockingStatuses].sort()).toEqual([
            ReconstructionStatus.Publishing,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Published
        ].sort());
    });

    test("admits nothing else, so live work leaves the neuron a candidate", () => {
        const notBlocking = [
            ReconstructionStatus.InProgress,
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.PeerReview,
            ReconstructionStatus.TeamReview,
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
            ReconstructionStatus.TeamReview,
            ReconstructionStatus.PublishReview,
            ReconstructionStatus.Approved,
            ReconstructionStatus.WaitingForAtlasReconstruction,
            ReconstructionStatus.ReadyToPublish,
            ReconstructionStatus.Rejected,
            ReconstructionStatus.Publishing,
            ReconstructionStatus.PublishFailed,
            ReconstructionStatus.Published
        ].sort());
    });

    test("releases the neuron when held, archived or soft-deleted", () => {
        const released = [
            ReconstructionStatus.OnHold,
            ReconstructionStatus.Incomplete,
            ReconstructionStatus.Duplicate,
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
