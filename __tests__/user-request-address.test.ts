import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {User, UserPermissions} = require("../src/models/user");

// Stands in for the shared instance a request actually receives - SystemNoUser, or an entry from the User cache.
function cachedUser(permissions: number = UserPermissions.Admin) {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    user.permissions = permissions;
    return user;
}

describe("withRequestAddress", () => {
    test("gives each concurrent request its own address", () => {
        const cached = cachedUser();

        const first = cached.withRequestAddress("203.0.113.1");
        const second = cached.withRequestAddress("203.0.113.2");

        expect(first.ip).toBe("203.0.113.1");
        expect(second.ip).toBe("203.0.113.2");
    });

    test("does not write the address onto the cached instance", () => {
        const cached = cachedUser();

        cached.withRequestAddress("203.0.113.1");

        expect(cached.ip).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(cached, "ip")).toBe(false);
    });

    // The interleaving the shared instance allowed: a second request arriving before the first reads its address.
    test("holds its address across an interleaved request", async () => {
        const cached = cachedUser();

        const first = cached.withRequestAddress("203.0.113.1");

        await Promise.resolve();

        const second = cached.withRequestAddress("203.0.113.2");

        await Promise.resolve();

        expect(first.ip).toBe("203.0.113.1");
        expect(second.ip).toBe("203.0.113.2");
    });

    test("still reads attributes from the cached instance", () => {
        const scoped = cachedUser(UserPermissions.PublishReview).withRequestAddress("203.0.113.1");

        expect(scoped.id).toBe("user-1");
        expect(scoped.permissions).toBe(UserPermissions.PublishReview);
    });

    test("still answers permission predicates", () => {
        const admin = cachedUser(UserPermissions.Admin).withRequestAddress("203.0.113.1");
        const reviewer = cachedUser(UserPermissions.PublishReview).withRequestAddress("203.0.113.2");

        expect(admin.isAdmin()).toBe(true);
        expect(admin.canViewRequestDiagnostics()).toBe(true);
        expect(reviewer.isAdmin()).toBe(false);
        expect(reviewer.canViewRequestDiagnostics()).toBe(false);
    });

    test("remains a User, so resolvers and model entry points accept it", () => {
        expect(cachedUser().withRequestAddress("203.0.113.1")).toBeInstanceOf(User);
    });

    test("reflects a later change to the cached instance rather than pinning a stale copy", () => {
        const cached = cachedUser(UserPermissions.None);

        const scoped = cached.withRequestAddress("203.0.113.1");

        cached.permissions = UserPermissions.Admin;

        expect(scoped.permissions).toBe(UserPermissions.Admin);
    });
});
