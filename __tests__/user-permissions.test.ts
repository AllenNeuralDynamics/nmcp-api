import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {User, UserPermissions, UserPermissionsAll} = require("../src/models/user");
const {DiscardableSourceStatuses, AdminDiscardableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");

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
        ReconstructionStatus.WaitingForAtlasReconstruction,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived
    ])("denies everyone at status %s", (status: number) => {
        expect(userWithPermissionsAndId(UserPermissions.Admin).canDiscardReconstruction("annotator-1", status)).toBe(false);
        expect(userWithPermissionsAndId(UserPermissions.AnnotateOne).canDiscardReconstruction("annotator-1", status)).toBe(false);
    });
});

describe("canUploadReconstructionData", () => {
    test("specimen space requires the bit matching the review the reconstruction is in", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(true);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(true);
    });

    test("specimen space denies the bit for the other review", () => {
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(false);
    });

    test("specimen space does not exempt an admin who holds neither review bit", () => {
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PeerReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, ReconstructionStatus.PublishReview)).toBe(false);
    });

    test.each([
        ReconstructionStatus.InProgress,
        ReconstructionStatus.OnHold,
        ReconstructionStatus.Approved,
        ReconstructionStatus.WaitingForAtlasReconstruction,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Rejected,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived
    ])("specimen space denies status %s outright", (status: number) => {
        expect(userWithPermissions(UserPermissions.Admin | UserPermissions.PeerReview | UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Specimen, status)).toBe(false);
    });

    test("atlas space allows an admin or the publish-review bit at any status", () => {
        expect(userWithPermissions(UserPermissions.Admin)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.Approved)).toBe(true);
        expect(userWithPermissions(UserPermissions.PublishReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(true);
    });

    test("atlas space denies a peer reviewer and an annotator", () => {
        expect(userWithPermissions(UserPermissions.PeerReview)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(false);
        expect(userWithPermissions(UserPermissions.AnnotateOne)
            .canUploadReconstructionData(ReconstructionSpace.Atlas, ReconstructionStatus.PublishReview)).toBe(false);
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

describe("permission bit values", () => {
    test("no stored permission integer changed meaning", () => {
        expect(UserPermissions.AnnotateOne).toBe(0x01);
        expect(UserPermissions.AnnotateMany).toBe(0x02);
        expect(UserPermissionsAll).toBe(4883);
    });
});
