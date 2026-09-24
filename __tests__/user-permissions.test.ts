import {expect, test, describe, vi, afterEach} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {User, UserPermissions, UserPermissionsAll} = require("../src/models/user");
const {DiscardableSourceStatuses, AdminDiscardableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AbandonableFailureStatuses, AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWithPermissions(permissions: number) {
    const user = Object.create(User.prototype);
    user.permissions = permissions;
    return user;
}

function userWithPermissionsAndId(permissions: number, id: string = "annotator-1") {
    const user = userWithPermissions(permissions);
    user.id = id;
    return user;
}

const allStatuses = Object.keys(ReconstructionStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => ReconstructionStatus[key] as number);

describe("canAnnotate", () => {
    test("allows either annotation bit, alone or together", () => {
        expect(userWithPermissions(UserPermissions.AnnotateOne).canAnnotate()).toBe(true);
        expect(userWithPermissions(UserPermissions.AnnotateMany).canAnnotate()).toBe(true);
        expect(userWithPermissions(UserPermissions.AnnotateOne | UserPermissions.AnnotateMany).canAnnotate()).toBe(true);
    });

    test("denies permissions that carry neither annotation bit", () => {
        expect(userWithPermissions(UserPermissions.None).canAnnotate()).toBe(false);
        expect(userWithPermissions(UserPermissions.Edit).canAnnotate()).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview).canAnnotate()).toBe(false);
        expect(userWithPermissions(UserPermissions.Admin).canAnnotate()).toBe(false);
    });
});

describe("canAnnotateMultiple", () => {
    test("allows only the AnnotateMany bit", () => {
        expect(userWithPermissions(UserPermissions.AnnotateMany).canAnnotateMultiple()).toBe(true);
        expect(userWithPermissions(UserPermissions.AnnotateOne | UserPermissions.AnnotateMany).canAnnotateMultiple()).toBe(true);
    });

    test("denies AnnotateOne and None", () => {
        expect(userWithPermissions(UserPermissions.AnnotateOne).canAnnotateMultiple()).toBe(false);
        expect(userWithPermissions(UserPermissions.None).canAnnotateMultiple()).toBe(false);
    });

    test("does not exempt an admin from the limit", () => {
        expect(userWithPermissions(UserPermissions.Admin).canAnnotateMultiple()).toBe(false);
    });
});

describe("canViewData", () => {
    test("denies only None", () => {
        expect(userWithPermissions(UserPermissions.None).canViewData()).toBe(false);
    });

    test("allows any single non-zero permission", () => {
        const permissions = [
            UserPermissions.AnnotateOne,
            UserPermissions.AnnotateMany,
            UserPermissions.Edit,
            UserPermissions.PeerReview,
            UserPermissions.TeamReview,
            UserPermissions.PublishReview,
            UserPermissions.Admin,
            UserPermissions.InternalAccess
        ];

        for (const permission of permissions) {
            expect(userWithPermissions(permission).canViewData()).toBe(true);
        }
    });
});

describe("canReviseReconstruction", () => {
    test("allows either annotation bit", () => {
        expect(userWithPermissions(UserPermissions.AnnotateOne).canReviseReconstruction()).toBe(true);
        expect(userWithPermissions(UserPermissions.AnnotateMany).canReviseReconstruction()).toBe(true);
    });

    test("denies None and a non-annotation permission", () => {
        expect(userWithPermissions(UserPermissions.None).canReviseReconstruction()).toBe(false);
        expect(userWithPermissions(UserPermissions.Edit).canReviseReconstruction()).toBe(false);
    });
});

describe("canMarkReconstructionUntraceable", () => {
    function userWithId(permissions: number) {
        const user = userWithPermissions(permissions);
        user.id = "annotator-1";
        return user;
    }

    test("allows an admin for any annotator", () => {
        expect(userWithId(UserPermissions.Admin).canMarkReconstructionUntraceable("annotator-2")).toBe(true);
    });

    test("allows the reconstruction's own annotator", () => {
        expect(userWithId(UserPermissions.AnnotateOne).canMarkReconstructionUntraceable("annotator-1")).toBe(true);
    });

    test("allows either review bit for another annotator's reconstruction", () => {
        expect(userWithId(UserPermissions.PeerReview).canMarkReconstructionUntraceable("annotator-2")).toBe(true);
        expect(userWithId(UserPermissions.PublishReview).canMarkReconstructionUntraceable("annotator-2")).toBe(true);
    });

    // The one rule with no diff behind it: the TeamReview bit is deliberately absent from the reviewer mask, so this
    // test is what holds it.  A team reviewer who finds a neuron untraceable rejects it instead.
    test("denies a team reviewer on another annotator's reconstruction", () => {
        expect(userWithId(UserPermissions.TeamReview).canMarkReconstructionUntraceable("annotator-2")).toBe(false);
    });

    test("denies a non-reviewer on another annotator's reconstruction", () => {
        expect(userWithId(UserPermissions.None).canMarkReconstructionUntraceable("annotator-2")).toBe(false);
        expect(userWithId(UserPermissions.Edit).canMarkReconstructionUntraceable("annotator-2")).toBe(false);
        expect(userWithId(UserPermissions.AnnotateOne).canMarkReconstructionUntraceable("annotator-2")).toBe(false);
        expect(userWithId(UserPermissions.AnnotateMany).canMarkReconstructionUntraceable("annotator-2")).toBe(false);
    });
});

describe("canRequestReview", () => {
    test("allows an admin for any annotator", () => {
        expect(userWithPermissionsAndId(UserPermissions.Admin).canRequestReview("annotator-2")).toBe(true);
    });

    test("allows the reconstruction's own annotator", () => {
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canRequestReview("annotator-1")).toBe(true);
    });

    test("denies a reviewer on someone else's reconstruction", () => {
        expect(userWithPermissionsAndId(UserPermissions.PeerReview).canRequestReview("annotator-2")).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.PublishReview).canRequestReview("annotator-2")).toBe(false);
    });

    test("denies another annotator", () => {
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canRequestReview("annotator-2")).toBe(false);
    });
});

describe("canDiscardReconstruction", () => {
    test.each(DiscardableSourceStatuses as number[])("allows the annotator and an admin at status %s", (status: number) => {
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-1", status)).toBe(true);
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-2", status)).toBe(true);
    });

    test.each(DiscardableSourceStatuses as number[])("denies another annotator at status %s", (status: number) => {
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-2", status)).toBe(false);
    });

    test.each(AdminDiscardableSourceStatuses as number[])("allows only an admin at status %s", (status: number) => {
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-2", status)).toBe(true);
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-1", status)).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.PublishReview).canDiscardReconstruction("annotator-2", status)).toBe(false);
    });

    test.each([
        ReconstructionStatus.Approved,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived
    ])("denies everyone at status %s", (status: number) => {
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-1", status)).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-1", status)).toBe(false);
    });

    /**
     * B1 and B2.  Past approval the parent status alone does not decide: WaitingForAtlasReconstruction is abandonable
     * only when the child has stopped at a failed phase, never while one is running, and the annotator is deliberately
     * absent from both.
     */
    test.each(AbandonableFailureStatuses as number[])("allows a publish reviewer and an admin at a child status of %s", (childStatus: number) => {
        const status = ReconstructionStatus.WaitingForAtlasReconstruction;

        expect(userWithPermissionsAndId(UserPermissions.PublishReview).canDiscardReconstruction("annotator-2", status, childStatus)).toBe(true);
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-2", status, childStatus)).toBe(true);
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-1", status, childStatus)).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.PeerReview).canDiscardReconstruction("annotator-2", status, childStatus)).toBe(false);
    });

    test("allows a publish reviewer and an admin at ReadyToPublish, whatever the child", () => {
        expect(userWithPermissionsAndId(UserPermissions.PublishReview).canDiscardReconstruction("annotator-2", ReconstructionStatus.ReadyToPublish)).toBe(true);
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-2", ReconstructionStatus.ReadyToPublish)).toBe(true);
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-1", ReconstructionStatus.ReadyToPublish)).toBe(false);
    });

    test.each([
        ["a null child", null],
        ["an indexing failure, which is a problem with that process rather than with the reconstruction", AtlasReconstructionStatus.FailedSearchIndexing],
        ["a phase actually running", AtlasReconstructionStatus.InStructureAssignment],
        ["a phase merely queued", AtlasReconstructionStatus.PendingQualityControl]
    ])("denies everyone at WaitingForAtlasReconstruction with %s", (_label: string, childStatus: number | null) => {
        const status = ReconstructionStatus.WaitingForAtlasReconstruction;

        expect(userWithPermissionsAndId(UserPermissions.PublishReview).canDiscardReconstruction("annotator-2", status, childStatus)).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-2", status, childStatus)).toBe(false);
    });
});

describe("canRejectReconstruction", () => {
    test("the review bit matching the review the reconstruction is in", () => {
        expect(userWithPermissions(UserPermissions.PeerReview).canRejectReconstruction(ReconstructionStatus.PeerReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.TeamReview).canRejectReconstruction(ReconstructionStatus.TeamReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PublishReview).canRejectReconstruction(ReconstructionStatus.PublishReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PeerReview).canRejectReconstruction(ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PeerReview).canRejectReconstruction(ReconstructionStatus.TeamReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.TeamReview).canRejectReconstruction(ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.TeamReview).canRejectReconstruction(ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview).canRejectReconstruction(ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview).canRejectReconstruction(ReconstructionStatus.TeamReview)).toBe(false);
    });

    // B2: ReadyToPublish was admin-only, and is now the publish reviewer's to reject as well.
    test("a publish reviewer may reject at ReadyToPublish", () => {
        expect(userWithPermissions(UserPermissions.PublishReview).canRejectReconstruction(ReconstructionStatus.ReadyToPublish)).toBe(true);
        expect(userWithPermissions(UserPermissions.PeerReview).canRejectReconstruction(ReconstructionStatus.ReadyToPublish)).toBe(false);
    });

    test.each(AbandonableFailureStatuses as number[])("a publish reviewer may reject a child stopped at %s", (childStatus: number) => {
        const status = ReconstructionStatus.WaitingForAtlasReconstruction;

        expect(userWithPermissions(UserPermissions.PublishReview).canRejectReconstruction(status, childStatus)).toBe(true);
        expect(userWithPermissions(UserPermissions.PeerReview).canRejectReconstruction(status, childStatus)).toBe(false);
        expect(userWithPermissions(UserPermissions.AnnotateOne).canRejectReconstruction(status, childStatus)).toBe(false);
    });

    test.each([
        ["a null child", null],
        ["an indexing failure", AtlasReconstructionStatus.FailedSearchIndexing],
        ["a phase actually running", AtlasReconstructionStatus.InDoiAssignment]
    ])("denies a publish reviewer at WaitingForAtlasReconstruction with %s", (_label: string, childStatus: number | null) => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canRejectReconstruction(ReconstructionStatus.WaitingForAtlasReconstruction, childStatus)).toBe(false);
    });

    // B3: the one route out of PublishFailed that is not another retry.  It is the pair that qualifies, not the parent
    // status - a PublishFailed parent whose child stopped anywhere else is still nobody's to reject.
    test("a publish reviewer may reject a PublishFailed parent whose child failed indexing", () => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canRejectReconstruction(ReconstructionStatus.PublishFailed, AtlasReconstructionStatus.FailedSearchIndexing)).toBe(true);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canRejectReconstruction(ReconstructionStatus.PublishFailed, AtlasReconstructionStatus.FailedSearchIndexing)).toBe(false);
        expect(userWithPermissions(UserPermissions.AnnotateOne)
            .canRejectReconstruction(ReconstructionStatus.PublishFailed, AtlasReconstructionStatus.FailedSearchIndexing)).toBe(false);
    });

    test.each([
        ["a null child", null],
        ["a child that finished", AtlasReconstructionStatus.Published],
        ["a child that failed elsewhere", AtlasReconstructionStatus.FailedQualityControl]
    ])("denies a publish reviewer at PublishFailed with %s", (_label: string, childStatus: number | null) => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canRejectReconstruction(ReconstructionStatus.PublishFailed, childStatus)).toBe(false);
    });

    // The regression guard for the shared predicate: isReviewerAbandonable is not widened, so the discard permission
    // does not follow reject to PublishFailed and then get refused by isDiscardable a moment later.
    test("the discard permission does not follow it to PublishFailed", () => {
        expect(userWithPermissionsAndId(UserPermissions.PublishReview)
            .canDiscardReconstruction("annotator-2", ReconstructionStatus.PublishFailed, AtlasReconstructionStatus.FailedSearchIndexing)).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.Admin)
            .canDiscardReconstruction("annotator-2", ReconstructionStatus.PublishFailed, AtlasReconstructionStatus.FailedSearchIndexing)).toBe(false);
    });

    // The admin bypass on this predicate predates the new sources and is unchanged.
    test("an admin may reject from any of them", () => {
        expect(userWithPermissions(UserPermissions.Admin).canRejectReconstruction(ReconstructionStatus.PeerReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.Admin).canRejectReconstruction(ReconstructionStatus.ReadyToPublish)).toBe(true);
    });
});

/**
 * The gate on every supervisory pipeline action: the five per-phase retries and the reset alike.  An admin holding no
 * review bit gets both, so the replay is never more available than the single retry it subsumes.
 */
describe("canOperateReconstructionPipeline", () => {
    test("allows an admin alone and a publish reviewer alone", () => {
        expect(userWithPermissions(UserPermissions.Admin).canOperateReconstructionPipeline()).toBe(true);
        expect(userWithPermissions(UserPermissions.PublishReview).canOperateReconstructionPipeline()).toBe(true);
    });

    test("denies a peer reviewer, an annotator and None", () => {
        expect(userWithPermissions(UserPermissions.PeerReview).canOperateReconstructionPipeline()).toBe(false);
        expect(userWithPermissions(UserPermissions.AnnotateOne).canOperateReconstructionPipeline()).toBe(false);
        expect(userWithPermissions(UserPermissions.None).canOperateReconstructionPipeline()).toBe(false);
    });
});

describe("canUploadReconstructionData", () => {
    test("specimen space requires the bit matching the review the reconstruction is in", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.TeamReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(true);
    });

    test("specimen space denies the bit for the other review", () => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(false);
    });

    // The admin bypass now applies in both spaces, which is what lets one status-to-bit map serve them both.
    test("specimen space exempts an admin who holds no review bit", () => {
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.TeamReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(true);
    });

    test.each([
        ReconstructionStatus.InProgress,
        ReconstructionStatus.OnHold,
        ReconstructionStatus.Incomplete,
        ReconstructionStatus.Duplicate,
        ReconstructionStatus.Approved,
        ReconstructionStatus.WaitingForAtlasReconstruction,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Rejected,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived
    ])("specimen space denies status %s outright", (status: number) => {
        expect(userWithPermissions(UserPermissions.Admin | UserPermissions.ReviewAll)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, status)).toBe(false);
    });

    test("atlas space allows an admin or the publish-review bit, at publish review", () => {
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(true);
    });

    // A team reviewer uploads in both spaces, so atlas space is no longer publish review's alone.
    test("atlas space allows an admin or the team-review bit, at team review", () => {
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.TeamReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.TeamReview)).toBe(true);
    });

    // The status rule the model's locked check used to carry alone: the eager predicate now refuses an atlas upload at
    // an inadmissible status rather than letting the file be parsed first.
    test.each(allStatuses.filter(status => status != ReconstructionStatus.TeamReview && status != ReconstructionStatus.PublishReview))(
        "atlas space denies status %s, for an admin as well",
        (status: number) => {
            expect(userWithPermissions(UserPermissions.Admin | UserPermissions.ReviewAll)
                .canUploadReconstructionData(ReconstructionSpace.Atlas, status)).toBe(false);
        });

    test("atlas space denies a peer reviewer and an annotator", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.TeamReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.AnnotateOne)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(false);
    });

    // The bit tracks the status, not the space: holding TeamReview is no licence to write atlas data at publish review.
    test("atlas space still pairs each review status with its own bit", () => {
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.TeamReview)).toBe(false);
    });

    // Specimen space keeps the bit tracking the status even with the bypass in place: the peer reviewer is not admitted
    // at publish review, and vice versa.
    test("specimen space still pairs each review status with its own bit", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.TeamReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.TeamReview)).toBe(false);
    });
});

/**
 * The source decides for the two review sign-offs and the target for the final approval, because PublishReview as a
 * target is now reachable from peer review and from team review alike.
 */
describe("canApproveReconstruction", () => {
    test("a peer reviewer signs off out of peer review, to either target", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canApproveReconstruction(ReconstructionStatus.TeamReview, ReconstructionStatus.PeerReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canApproveReconstruction(ReconstructionStatus.PublishReview, ReconstructionStatus.PeerReview)).toBe(true);
    });

    test("a peer reviewer is refused out of team review", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canApproveReconstruction(ReconstructionStatus.PublishReview, ReconstructionStatus.TeamReview)).toBe(false);
    });

    test("a team reviewer signs off out of team review", () => {
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canApproveReconstruction(ReconstructionStatus.PublishReview, ReconstructionStatus.TeamReview)).toBe(true);
    });

    test("a team reviewer is refused out of peer review", () => {
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canApproveReconstruction(ReconstructionStatus.TeamReview, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canApproveReconstruction(ReconstructionStatus.PublishReview, ReconstructionStatus.PeerReview)).toBe(false);
    });

    test("only the publish-review bit approves to Approved", () => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canApproveReconstruction(ReconstructionStatus.Approved, ReconstructionStatus.PublishReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canApproveReconstruction(ReconstructionStatus.Approved, ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.TeamReview)
            .canApproveReconstruction(ReconstructionStatus.Approved, ReconstructionStatus.PublishReview)).toBe(false);
    });

    // Neither review bit reaches a sign-off it does not own, and the publish reviewer's does not reach the earlier two.
    test("a publish reviewer is refused out of either review", () => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canApproveReconstruction(ReconstructionStatus.TeamReview, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canApproveReconstruction(ReconstructionStatus.PublishReview, ReconstructionStatus.TeamReview)).toBe(false);
    });

    test.each([
        [ReconstructionStatus.TeamReview, ReconstructionStatus.PeerReview],
        [ReconstructionStatus.PublishReview, ReconstructionStatus.PeerReview],
        [ReconstructionStatus.PublishReview, ReconstructionStatus.TeamReview],
        [ReconstructionStatus.Approved, ReconstructionStatus.PublishReview]
    ])("an admin approves to %s from %s", (targetStatus: number, currentStatus: number) => {
        expect(userWithPermissions(UserPermissions.Admin).canApproveReconstruction(targetStatus, currentStatus)).toBe(true);
    });
});

describe("canOpenIssue", () => {
    test("allows any non-zero permission", () => {
        expect(userWithPermissions(UserPermissions.AnnotateOne).canOpenIssue()).toBe(true);
        expect(userWithPermissions(UserPermissions.Edit).canOpenIssue()).toBe(true);
    });

    test("denies only None", () => {
        expect(userWithPermissions(UserPermissions.None).canOpenIssue()).toBe(false);
    });
});

/**
 * The internal surface is closed by permission rather than by route, so InternalAccess alone is the gate on every
 * operation internalResolvers.ts reaches.  An admin is refused deliberately: each of these either asserts pipeline
 * state on behalf of a service or hands internal data to one, and an admin standing in for the internal system user
 * is how precomputed generation gets marked complete with no volume behind it.
 */
describe("the internal gates", () => {
    const gates = [
        "canRequestReconstructionData",
        "canViewRequestDiagnostics",
        "canRequestPendingPrecomputed",
        "canUpdatePrecomputed"
    ];

    test.each(gates)("%s allows a caller holding InternalAccess", (gate: string) => {
        expect(userWithPermissions(UserPermissions.InternalAccess)[gate]()).toBe(true);
    });

    test.each(gates)("%s allows the internal system user's permissions", (gate: string) => {
        expect(userWithPermissions(UserPermissions.InternalSystem)[gate]()).toBe(true);
    });

    test.each(gates)("%s refuses an admin", (gate: string) => {
        expect(userWithPermissions(UserPermissions.Admin)[gate]()).toBe(false);
        expect(userWithPermissions(UserPermissions.Admin | UserPermissions.ReviewAll)[gate]()).toBe(false);
    });

    test.each(gates)("%s refuses a reviewer and None", (gate: string) => {
        expect(userWithPermissions(UserPermissions.PublishReview)[gate]()).toBe(false);
        expect(userWithPermissions(UserPermissions.None)[gate]()).toBe(false);
    });

    // canModifyReconstruction gates metadata edits and nothing else now, and stays PublishReview-only: editing a
    // reconstruction's own metadata is a reviewer's job.  What an admin uses for the pipeline is
    // canOperateReconstructionPipeline, which does carry the admin bypass.
    test("canModifyReconstruction has no admin bypass", () => {
        expect(userWithPermissions(UserPermissions.Admin | UserPermissions.PublishReview).canModifyReconstruction()).toBe(true);
        expect(userWithPermissions(UserPermissions.Admin).canModifyReconstruction()).toBe(false);
    });
});

describe("permission bit values", () => {
    test("no stored permission integer changed meaning", () => {
        expect(UserPermissions.AnnotateOne).toBe(0x01);
        expect(UserPermissions.AnnotateMany).toBe(0x02);
        expect(UserPermissions.TeamReview).toBe(0x400);
        expect(UserPermissionsAll).toBe(5907);
    });
});

/**
 * UserPermissionsAll is the whole normal-user set, and InternalAccess is deliberately outside it: the internal surface
 * is closed by permission rather than by route, so the bit is the entire boundary and updatePermissions is the only
 * path that writes an arbitrary value.  verifySystemUser seeds the system users directly and does not come through
 * here.
 */
describe("updatePermissions guard", () => {
    const admin = userWithPermissionsAndId(UserPermissions.Admin, "admin-1");

    function target() {
        const user = Object.create(User.prototype);

        Object.assign(user, {id: "user-1", isSystemUser: false, authDirectoryId: "dir-1", permissions: UserPermissions.AnnotateOne});

        user.updateForShape = vi.fn().mockImplementation(async (shape: any) => {
            Object.assign(user, shape);
            return user;
        });

        vi.spyOn(User, "findByPk").mockResolvedValue(user);

        return user;
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test.each([
        ["the whole normal-user set", UserPermissionsAll],
        ["AnnotateOne", UserPermissions.AnnotateOne],
        ["AnnotateMany", UserPermissions.AnnotateMany],
        ["Edit", UserPermissions.Edit],
        ["PublishReview", UserPermissions.PublishReview],
        ["PeerReview", UserPermissions.PeerReview],
        ["Admin", UserPermissions.Admin],
        ["None", UserPermissions.None]
    ])("accepts %s and writes it", async (_label: string, permissions: number) => {
        const user = target();

        const updated = await User.updatePermissions("user-1", permissions, admin);

        expect(user.updateForShape).toHaveBeenCalledWith({permissions: permissions}, admin);
        expect(updated.permissions).toBe(permissions);
    });

    test.each([
        ["InternalAccess", UserPermissions.InternalAccess],
        ["InternalSystem", UserPermissions.InternalSystem],
        ["the normal-user set with InternalAccess added", UserPermissionsAll | UserPermissions.InternalAccess],
        ["an unassigned bit inside the reserved range", 0x04]
    ])("refuses %s with code 1006 and writes nothing", async (_label: string, permissions: number) => {
        const user = target();

        await expect(User.updatePermissions("user-1", permissions, admin)).rejects.toMatchObject({
            message: "That permissions value includes bits an ordinary account cannot hold.",
            extensions: {code: 1006}
        });

        expect(user.updateForShape).not.toHaveBeenCalled();
    });

    // The bitwise operators coerce to int32, so 2**31 wraps negative and would pass the mask on its own; the explicit
    // range clause is what closes that, and a non-integer would otherwise be written verbatim.
    test.each([
        ["a value at the int32 boundary", 2 ** 31],
        ["a value above it", 2 ** 32],
        ["a negative value", -1],
        ["a non-integer", 1.5],
        ["NaN", Number.NaN]
    ])("refuses %s with code 1006", async (_label: string, permissions: number) => {
        const user = target();

        await expect(User.updatePermissions("user-1", permissions, admin)).rejects.toMatchObject({extensions: {code: 1006}});

        expect(user.updateForShape).not.toHaveBeenCalled();
    });

    // The guard sits after the target is resolved, so an invalid value cannot be used to tell a system user from an id
    // that names nobody: both answer null rather than an error.
    test.each([
        ["a system user", {isSystemUser: true}],
        ["no user at all", null]
    ])("returns null for %s even when the value is also invalid", async (_label: string, stub: object | null) => {
        vi.spyOn(User, "findByPk").mockResolvedValue(stub === null ? null : Object.assign(Object.create(User.prototype), stub));

        expect(await User.updatePermissions("user-1", UserPermissions.InternalAccess, admin)).toBeNull();
    });

    test("refuses a caller without canEditUsers before the target is even read", async () => {
        const findByPk = vi.spyOn(User, "findByPk").mockResolvedValue(null);

        await expect(User.updatePermissions("user-1", UserPermissions.AnnotateOne, userWithPermissionsAndId(UserPermissions.PublishReview, "reviewer-1")))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(findByPk).not.toHaveBeenCalled();
    });
});
