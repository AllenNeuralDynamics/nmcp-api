import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions, UserPermissionsAll, ApiKeyPermissionsAll} = require("../src/models/user");
const {ApiKey} = require("../src/models/apiKey");
const {EventLogItem} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function stubCreation(owner: any) {
    vi.spyOn(User, "findUserOrId").mockResolvedValue(owner);
    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

    Object.defineProperty(ApiKey, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    return vi.spyOn(ApiKey, "create").mockImplementation(async (values: any) => values);
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (ApiKey as any).sequelize;
});

describe("ApiKeyPermissionsAll", () => {
    // The whole point of the constant: a key is used unattended by a script and outlives the session that minted it.
    test("is the ordinary-user set without the admin bits", () => {
        expect(ApiKeyPermissionsAll & UserPermissions.Admin).toBe(0);
        expect(ApiKeyPermissionsAll & UserPermissions.InternalAccess).toBe(0);
        expect(ApiKeyPermissionsAll).toBe(UserPermissionsAll & ~UserPermissions.AdminAll);
    });
});

describe("createApiKey permissions", () => {
    test("defaults to the owner's permissions with the admin bits masked out", async () => {
        const create = stubCreation(userWith(UserPermissions.Admin | UserPermissions.PublishReview | UserPermissions.EditAll));

        await ApiKey.createApiKey("user-1", "source-key");

        expect((create.mock.calls[0][0] as any).permissions).toBe(UserPermissions.PublishReview | UserPermissions.EditAll);
    });

    // Not a failure: admin power is not delegable to a credential, so an account that holds nothing else has nothing
    // to hand a key.
    test("an owner holding only Admin mints an empty key", async () => {
        const create = stubCreation(userWith(UserPermissions.Admin));

        await ApiKey.createApiKey("user-1", "source-key");

        expect((create.mock.calls[0][0] as any).permissions).toBe(UserPermissions.None);
    });

    test("stores an explicit in-range value verbatim", async () => {
        const create = stubCreation(userWith(UserPermissionsAll));

        await ApiKey.createApiKey("user-1", "source-key", "a narrow key", 30, UserPermissions.PublishReview);

        expect((create.mock.calls[0][0] as any).permissions).toBe(UserPermissions.PublishReview);
    });

    // The guard createApiKey had no equivalent of while the column was inert, which is exactly what honoring it ends.
    test.each([
        ["Admin", UserPermissions.Admin],
        ["Admin alongside a legitimate bit", UserPermissions.Admin | UserPermissions.PublishReview],
        ["InternalAccess", UserPermissions.InternalAccess],
        ["InternalSystem", UserPermissions.InternalSystem],
        ["a negative value", -1],
        ["a non-integer", 1.5],
        ["a value above the mask, which would wrap an int32", 2 ** 31]
    ])("refuses %s with code 1006, before the transaction opens", async (_label: string, permissions: number) => {
        const create = stubCreation(userWith(UserPermissionsAll));

        await expect(ApiKey.createApiKey("user-1", "source-key", null, null, permissions)).rejects.toMatchObject({
            message: "That permissions value includes bits an API key cannot hold.",
            extensions: {code: 1006}
        });

        expect(create).not.toHaveBeenCalled();
        expect((ApiKey as any).sequelize.transaction).not.toHaveBeenCalled();
    });
});

describe("authenticateKey", () => {
    function stubKey(keyPermissions: number, owner: any) {
        vi.spyOn(ApiKey, "findOne").mockResolvedValue({
            userId: owner?.id ?? "user-1",
            permissions: keyPermissions
        } as any);

        return vi.spyOn(User, "findByPk").mockResolvedValue(owner);
    }

    test("answers with the key's permissions rather than the owner's", async () => {
        stubKey(UserPermissions.PublishReview, userWith(UserPermissions.Admin | UserPermissions.PublishReview));

        const user = await ApiKey.authenticateKey("source-key");

        expect(user.permissions).toBe(UserPermissions.PublishReview);
        expect(user.canPublish()).toBe(true);
        expect(user.isAdmin()).toBe(false);
    });

    // No intersection with what the owner holds now, and no fallback to it: the key is the credential.
    test("a key wider than its owner's current permissions still answers off the key", async () => {
        stubKey(UserPermissions.PublishReview, userWith(UserPermissions.None));

        expect((await ApiKey.authenticateKey("source-key")).canPublish()).toBe(true);
    });

    test("is still a User, and still reads the owner's other attributes", async () => {
        stubKey(UserPermissions.EditAll, userWith(UserPermissions.Admin, "owner-7"));

        const user = await ApiKey.authenticateKey("source-key");

        expect(user).toBeInstanceOf(User);
        expect(user.id).toBe("owner-7");
    });

    // ApiKey.userId is nullable, so this is representable.  It authenticated as null before and must go on doing so:
    // calling the view method on nothing would turn an invalid credential into a 500 inside context construction.
    test("returns null, rather than throwing, when the owner cannot be resolved", async () => {
        stubKey(UserPermissions.PublishReview, null);

        expect(await ApiKey.authenticateKey("source-key")).toBeNull();
    });

    test("an unknown or expired key still returns null", async () => {
        vi.spyOn(ApiKey, "findOne").mockResolvedValue(null as any);

        expect(await ApiKey.authenticateKey("source-key")).toBeNull();
        expect(await ApiKey.authenticateKey(null)).toBeNull();
    });

    // The expiration is part of the lookup rather than a second test, so pin that it is still asked for.
    test("only considers a key that has not expired", async () => {
        const findOne = vi.spyOn(ApiKey, "findOne").mockResolvedValue(null as any);

        await ApiKey.authenticateKey("source-key");

        expect((findOne.mock.calls[0][0] as any).where.expiration).toBeDefined();
    });
});

describe("withKeyPermissions", () => {
    /**
     * modelInit never runs under vitest, so User.prototype carries no Sequelize accessors and a stand-in built with a
     * plain own property cannot see the hazard this method exists for: `permissions` is an attribute whose accessor
     * writes through to dataValues, which a view inherits by reference from the cached instance.  This rebuilds that
     * shape - a prototype-level accessor over a shared dataValues - so an implementation that assigns rather than
     * defines is caught rather than passing vacuously.
     */
    function cachedUserWithAccessor(permissions: number) {
        const prototype = Object.create(User.prototype);

        Object.defineProperty(prototype, "permissions", {
            get(this: any) {
                return this.dataValues.permissions;
            },
            set(this: any, value: number) {
                this.dataValues.permissions = value;
            },
            configurable: true
        });

        const user = Object.create(prototype);

        user.id = "user-1";
        user.dataValues = {permissions: permissions};

        return user;
    }

    test("does not write through to the cached instance's dataValues", () => {
        const cached = cachedUserWithAccessor(UserPermissions.Admin | UserPermissions.PublishReview);

        const scoped = cached.withKeyPermissions(UserPermissions.EditAll);

        expect(scoped.permissions).toBe(UserPermissions.EditAll);
        expect(cached.permissions).toBe(UserPermissions.Admin | UserPermissions.PublishReview);
        expect(cached.dataValues.permissions).toBe(UserPermissions.Admin | UserPermissions.PublishReview);
    });

    test("gives two concurrent requests on one account their own permissions", () => {
        const cached = cachedUserWithAccessor(UserPermissions.Admin);

        const first = cached.withKeyPermissions(UserPermissions.PublishReview);
        const second = cached.withKeyPermissions(UserPermissions.AnnotateOne);

        expect(first.permissions).toBe(UserPermissions.PublishReview);
        expect(second.permissions).toBe(UserPermissions.AnnotateOne);
        expect(cached.permissions).toBe(UserPermissions.Admin);
    });

    // The inverse of withRequestAddress's delegation test: the address view follows the cached user, the key view
    // deliberately does not for the one field it shadows.
    test("a later change to the cached user does not leak into the view", () => {
        const cached = cachedUserWithAccessor(UserPermissions.None);

        const scoped = cached.withKeyPermissions(UserPermissions.EditAll);

        cached.permissions = UserPermissions.Admin;

        expect(scoped.permissions).toBe(UserPermissions.EditAll);
        expect(scoped.isAdmin()).toBe(false);
    });

    // app.ts composes the two: authenticateKey returns the key view and withRequestAddress layers over it.
    test("composes with withRequestAddress", () => {
        const scoped = cachedUserWithAccessor(UserPermissions.Admin)
            .withKeyPermissions(UserPermissions.PublishReview)
            .withRequestAddress("203.0.113.1");

        expect(scoped.ip).toBe("203.0.113.1");
        expect(scoped.permissions).toBe(UserPermissions.PublishReview);
        expect(scoped.isAdmin()).toBe(false);
    });
});
