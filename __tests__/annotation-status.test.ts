import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {
    ClosedAnnotationStatuses,
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
} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");

// A numeric TS enum carries reverse mappings, so Object.keys is twice the member count.
const statusMemberCount = Object.keys(AnnotationStatus).filter(key => isNaN(Number(key))).length;

describe("AnnotationStatus values", () => {
    // The values are the persisted status column and the client mirrors them; the split renamed the enum, not them.
    const expected: [string, number][] = [
        ["InProgress", 100],
        ["OnHold", 200],
        ["Incomplete", 210],
        ["Duplicate", 220],
        ["PeerReview", 300],
        ["TeamReview", 350],
        ["PublishReview", 400],
        ["Approved", 500],
        ["WaitingForAtlasReconstruction", 600],
        ["ReadyToPublish", 700],
        ["Rejected", 800],
        ["Publishing", 900],
        ["Published", 1000],
        ["PublishFailed", 1100],
        ["Archived", 5000],
        ["Untraceable", 6000],
        ["Discarded", 10000]
    ];

    test.each(expected)("%s is %i", (name: string, value: number) => {
        expect(AnnotationStatus[name]).toBe(value);
    });

    test("has no other members", () => {
        expect(statusMemberCount).toBe(expected.length);
    });
});

describe("AnnotationStatus hold values", () => {
    // The client mirrors these numbers.
    test("Incomplete is 210", () => {
        expect(AnnotationStatus.Incomplete).toBe(210);
    });

    test("Duplicate is 220", () => {
        expect(AnnotationStatus.Duplicate).toBe(220);
    });
});

describe("ClosedAnnotationStatuses", () => {
    test("contains exactly the closed statuses", () => {
        expect([...ClosedAnnotationStatuses].sort()).toEqual([
            AnnotationStatus.Rejected,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.Discarded
        ].sort());
    });

    test("excludes every status at which a reconstruction is still open", () => {
        const stillOpen = [
            AnnotationStatus.InProgress,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.PublishFailed
        ];

        for (const status of stillOpen) {
            expect(ClosedAnnotationStatuses).not.toContain(status);
        }

        // Fails if a status is added to the enum without being classified either way.
        expect(stillOpen.length + ClosedAnnotationStatuses.length).toBe(statusMemberCount);
    });
});

describe("AnnotationLimitExemptStatuses", () => {
    test("contains exactly the closed statuses plus the holds", () => {
        expect([...AnnotationLimitExemptStatuses].sort()).toEqual([
            AnnotationStatus.Rejected,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.Discarded,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate
        ].sort());
    });

    test("contains every closed status", () => {
        for (const status of ClosedAnnotationStatuses) {
            expect(AnnotationLimitExemptStatuses).toContain(status);
        }
    });

    test("excludes every status that still holds the slot", () => {
        const stillCounting = [
            AnnotationStatus.InProgress,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.PublishFailed
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
            AnnotationStatus.InProgress,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.Rejected
        ].sort());
    });

    test("refuses the review pipeline onwards and every terminal status", () => {
        const refused = [
            AnnotationStatus.PeerReview,
            // Decided, not overlooked: a team reviewer who finds a neuron untraceable rejects it, and the annotator
            // marks it untraceable from Rejected.  See User.canMarkAnnotationUntraceable.
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
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
            AnnotationStatus.InProgress,
            AnnotationStatus.Rejected
        ].sort());
    });

    test("refuses a held reconstruction, the review pipeline and every terminal status", () => {
        const refused = [
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
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
            AnnotationStatus.InProgress,
            AnnotationStatus.Rejected
        ].sort());
    });

    test("refuses an already held reconstruction, the review pipeline and every terminal status", () => {
        const refused = [
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
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
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate
        ].sort());
    });

    test("refuses every status that is not a hold", () => {
        const refused = [
            AnnotationStatus.InProgress,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Rejected,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
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
            AnnotationStatus.InProgress,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.Rejected
        ].sort());
    });

    test("refuses the review pipeline onwards and every terminal status", () => {
        const refused = [
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
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
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview
        ].sort());
    });

    test("refuses everything an annotator may discard from and everything from Approved onwards", () => {
        const refused = [
            AnnotationStatus.InProgress,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.Rejected,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
        ];

        for (const status of refused) {
            expect(AdminDiscardableSourceStatuses).not.toContain(status);
        }

        expect(refused.length + AdminDiscardableSourceStatuses.length).toBe(statusMemberCount);
    });
});

describe("ApprovalSourceStatuses", () => {
    test("maps each approval target onto the statuses it may come from", () => {
        expect(ApprovalSourceStatuses.get(AnnotationStatus.TeamReview)).toEqual([AnnotationStatus.PeerReview]);

        // Team review is optional, so the publish-review target has two sources.
        expect(ApprovalSourceStatuses.get(AnnotationStatus.PublishReview)).toEqual([AnnotationStatus.PeerReview, AnnotationStatus.TeamReview]);

        expect(ApprovalSourceStatuses.get(AnnotationStatus.Approved)).toEqual([AnnotationStatus.PublishReview]);
    });

    test("no other status is an approval target", () => {
        const notATarget = [
            AnnotationStatus.InProgress,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.PeerReview,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Rejected,
            AnnotationStatus.Publishing,
            AnnotationStatus.Published,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Discarded
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
            AnnotationStatus.Publishing,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Published
        ].sort());
    });

    test("admits nothing else, so live work leaves the neuron a candidate", () => {
        const notBlocking = [
            AnnotationStatus.InProgress,
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Rejected,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.Discarded
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
            AnnotationStatus.InProgress,
            AnnotationStatus.PeerReview,
            AnnotationStatus.TeamReview,
            AnnotationStatus.PublishReview,
            AnnotationStatus.Approved,
            AnnotationStatus.WaitingForAtlasReconstruction,
            AnnotationStatus.ReadyToPublish,
            AnnotationStatus.Rejected,
            AnnotationStatus.Publishing,
            AnnotationStatus.PublishFailed,
            AnnotationStatus.Published
        ].sort());
    });

    test("releases the neuron when held, archived or soft-deleted", () => {
        const released = [
            AnnotationStatus.OnHold,
            AnnotationStatus.Incomplete,
            AnnotationStatus.Duplicate,
            AnnotationStatus.Archived,
            AnnotationStatus.Untraceable,
            AnnotationStatus.Discarded
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
