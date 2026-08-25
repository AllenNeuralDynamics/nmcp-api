import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {User, UserPermissions, UserPermissionsAll} = require("../src/models/user");

function userWithPermissions(permissions: number) {
    const user = Object.create(User.prototype);
    user.permissions = permissions;
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
