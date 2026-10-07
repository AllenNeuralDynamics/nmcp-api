import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions, UserPermissionsAll, UserPermissionsMultipleAnnotationsAll, UserPermissionsSingleAnnotationAll, apiKeyPermissionsAll, narrowApiKeyPermissions, losesCapability} = require("../src/models/user");
const {ApiKey} = require("../src/models/apiKey");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

const carriesTransaction = expect.objectContaining({transaction: transaction});

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

describe("apiKeyPermissionsAll", () => {
    // The whole point of the mask: a key is used unattended by a script and outlives the session that minted it.
    test.each([
        ["a multiple-annotation owner", UserPermissions.AnnotateMany, UserPermissionsMultipleAnnotationsAll],
        ["an owner with no annotation bit", UserPermissions.PeerReview, UserPermissionsMultipleAnnotationsAll],
        ["a single-annotation owner", UserPermissions.AnnotateOne, UserPermissionsSingleAnnotationAll],
        ["an owner holding both annotation bits", UserPermissions.AnnotateOne | UserPermissions.AnnotateMany, UserPermissionsSingleAnnotationAll]
    ])("for %s is that annotation variant without the admin bits", (_label: string, ownerPermissions: number, annotationAll: number) => {
        const mask = apiKeyPermissionsAll(ownerPermissions);

        expect(mask & UserPermissions.Admin).toBe(0);
        expect(mask & UserPermissions.InternalAccess).toBe(0);
        expect(mask).toBe(annotationAll & ~UserPermissions.AdminAll);
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

    test("defaults a single-annotation owner's key to keep AnnotateOne", async () => {
        const create = stubCreation(userWith(UserPermissions.AnnotateOne | UserPermissions.PeerReview));

        await ApiKey.createApiKey("user-1", "source-key");

        expect((create.mock.calls[0][0] as any).permissions).toBe(UserPermissions.AnnotateOne | UserPermissions.PeerReview);
    });

    test("defaults an owner holding both annotation bits to the single-annotation variant", async () => {
        const create = stubCreation(userWith(UserPermissions.AnnotateOne | UserPermissions.AnnotateMany | UserPermissions.PeerReview));

        await ApiKey.createApiKey("user-1", "source-key");

        expect((create.mock.calls[0][0] as any).permissions).toBe(UserPermissions.AnnotateOne | UserPermissions.PeerReview);
    });

    test.each([
        ["AnnotateMany for a single-annotation owner", UserPermissions.AnnotateOne, UserPermissions.AnnotateMany],
        ["AnnotateMany for an owner holding both annotation bits", UserPermissions.AnnotateOne | UserPermissions.AnnotateMany, UserPermissions.AnnotateMany],
        ["AnnotateOne for a multiple-annotation owner", UserPermissions.AnnotateMany, UserPermissions.AnnotateOne]
    ])("refuses %s with code 1006", async (_label: string, ownerPermissions: number, permissions: number) => {
        const create = stubCreation(userWith(ownerPermissions));

        await expect(ApiKey.createApiKey("user-1", "source-key", null, null, permissions)).rejects.toMatchObject({
            extensions: {code: 1006}
        });

        expect(create).not.toHaveBeenCalled();
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
        const create = stubCreation(userWith(UserPermissionsMultipleAnnotationsAll));

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

// Mirrors the rule independently, so the invariants below are not checked against the implementation itself.
function annotationLevel(permissions: number): number {
    if ((permissions & UserPermissions.AnnotateOne) !== 0) {
        return 1;
    }

    return (permissions & UserPermissions.AnnotateMany) !== 0 ? 2 : 0;
}

const annotationBits = UserPermissions.AnnotateOne | UserPermissions.AnnotateMany;

// Every bit the rule distinguishes; each subset of these is one value in the exhaustive checks.
const sweepBits = [UserPermissions.AnnotateOne, UserPermissions.AnnotateMany, UserPermissions.Edit, UserPermissions.PublishReview,
    UserPermissions.PeerReview, UserPermissions.TeamReview, UserPermissions.Admin];

function subsetValue(subset: number): number {
    return sweepBits.reduce((value: number, bit: number, position: number) => (subset & (1 << position)) !== 0 ? value | bit : value, 0);
}

const allSubsetValues = Array.from({length: 1 << sweepBits.length}, (_unused, subset) => subsetValue(subset));

describe("narrowApiKeyPermissions", () => {
    test.each([
        ["owner Many to One", UserPermissions.AnnotateMany | UserPermissions.PublishReview, UserPermissions.AnnotateOne | UserPermissions.PublishReview, UserPermissions.AnnotateOne | UserPermissions.PublishReview],
        ["owner One to Many", UserPermissions.AnnotateOne | UserPermissions.PeerReview, UserPermissions.AnnotateMany | UserPermissions.PeerReview, UserPermissions.AnnotateOne | UserPermissions.PeerReview],
        ["owner loses annotation", UserPermissions.AnnotateMany | UserPermissions.EditAll, UserPermissions.EditAll, UserPermissions.EditAll],
        ["owner drops one review bit", UserPermissions.AnnotateMany | UserPermissions.PublishReview | UserPermissions.PeerReview, UserPermissions.AnnotateMany | UserPermissions.PeerReview, UserPermissions.AnnotateMany | UserPermissions.PeerReview],
        ["a key with no annotation bit stays without one", UserPermissions.PublishReview, UserPermissions.AnnotateMany | UserPermissions.PublishReview, UserPermissions.PublishReview],
        ["an owner holding both bits counts as One", UserPermissions.AnnotateMany, UserPermissions.AnnotateOne | UserPermissions.AnnotateMany, UserPermissions.AnnotateOne],
        ["a key holding both bits counts as One", UserPermissions.AnnotateOne | UserPermissions.AnnotateMany, UserPermissions.AnnotateMany, UserPermissions.AnnotateOne],
        ["an owner holding only Admin", UserPermissions.EditAll | UserPermissions.TeamReview, UserPermissions.Admin, UserPermissions.None],
        ["a key already within its owner", UserPermissions.AnnotateMany | UserPermissions.EditAll, UserPermissionsMultipleAnnotationsAll, UserPermissions.AnnotateMany | UserPermissions.EditAll]
    ])("%s", (_label: string, key: number, owner: number, expected: number) => {
        expect(narrowApiKeyPermissions(key, owner)).toBe(expected);
    });

    test("never adds capability, over every combination", () => {
        const counterexamples: object[] = [];

        for (const key of allSubsetValues) {
            for (const owner of allSubsetValues) {
                const narrowed = narrowApiKeyPermissions(key, owner);
                const otherBits = narrowed & ~annotationBits;
                const annotation = narrowed & annotationBits;
                const expectedLevel = Math.min(annotationLevel(key), annotationLevel(owner));

                const holds = (otherBits & ~key) === 0
                    && (otherBits & ~owner) === 0
                    && annotation !== annotationBits
                    && annotationLevel(annotation) === expectedLevel
                    && narrowApiKeyPermissions(narrowed, owner) === narrowed;

                if (!holds) {
                    counterexamples.push({key, owner, narrowed});
                }
            }
        }

        expect(counterexamples).toEqual([]);
    });
});

describe("losesCapability", () => {
    test.each([
        ["Many to One", UserPermissions.AnnotateMany, UserPermissions.AnnotateOne, true],
        ["One to Many", UserPermissions.AnnotateOne, UserPermissions.AnnotateMany, false],
        ["Many to none", UserPermissions.AnnotateMany, UserPermissions.None, true],
        ["both bits to Many", UserPermissions.AnnotateOne | UserPermissions.AnnotateMany, UserPermissions.AnnotateMany, false],
        ["Many to both bits", UserPermissions.AnnotateMany, UserPermissions.AnnotateOne | UserPermissions.AnnotateMany, true],
        ["an unchanged value", UserPermissions.AnnotateMany | UserPermissions.Edit, UserPermissions.AnnotateMany | UserPermissions.Edit, false],
        ["gaining TeamReview", UserPermissions.PeerReview, UserPermissions.PeerReview | UserPermissions.TeamReview, false],
        ["losing PeerReview", UserPermissions.PeerReview | UserPermissions.TeamReview, UserPermissions.TeamReview, true],
        ["losing Admin", UserPermissions.Admin | UserPermissions.AnnotateMany, UserPermissions.AnnotateMany, true],
        ["trading PeerReview for TeamReview", UserPermissions.PeerReview, UserPermissions.TeamReview, true]
    ])("%s", (_label: string, previous: number, next: number, expected: boolean) => {
        expect(losesCapability(previous, next)).toBe(expected);
    });

    // Ties the gate exactly to "a key holding everything the owner held would change".
    test("is true exactly when a key equal to the old permissions would be narrowed", () => {
        const counterexamples: object[] = [];

        for (const previous of allSubsetValues) {
            for (const next of allSubsetValues) {
                const changes = narrowApiKeyPermissions(previous, next) !== narrowApiKeyPermissions(previous, previous);

                if (losesCapability(previous, next) !== changes) {
                    counterexamples.push({previous, next});
                }
            }
        }

        expect(counterexamples).toEqual([]);
    });
});

describe("findByUserId", () => {
    test("reads every key of the owner in the given transaction, expired ones included", async () => {
        const findAll = vi.spyOn(ApiKey, "findAll").mockResolvedValue([]);

        await ApiKey.findByUserId("user-1", transaction);

        expect(findAll).toHaveBeenCalledWith({where: {userId: "user-1"}, transaction: transaction});
    });

    test("without a transaction, passes null", async () => {
        const findAll = vi.spyOn(ApiKey, "findAll").mockResolvedValue([]);

        await ApiKey.findByUserId("user-1");

        expect(findAll).toHaveBeenCalledWith({where: {userId: "user-1"}, transaction: null});
    });
});

describe("narrowForOwner", () => {
    const updater = userWith(UserPermissions.Admin, "admin-1");

    function keyStub(id: string, permissions: number) {
        const apiKey = Object.create(ApiKey.prototype);

        Object.assign(apiKey, {id, permissions});

        apiKey.update = vi.fn().mockImplementation(async (values: any) => {
            Object.assign(apiKey, values);
            return apiKey;
        });

        apiKey.destroy = vi.fn().mockResolvedValue(undefined);

        return apiKey;
    }

    function stubKeys(apiKeys: any[]) {
        const findByUserId = vi.spyOn(ApiKey, "findByUserId").mockResolvedValue(apiKeys);
        const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        return {findByUserId, create};
    }

    test("writes and logs only the keys whose value changes", async () => {
        const wide = keyStub("key-wide", UserPermissions.AnnotateMany | UserPermissions.PublishReview);
        const compliant = keyStub("key-compliant", UserPermissions.AnnotateMany);
        const {findByUserId, create} = stubKeys([wide, compliant]);

        await ApiKey.narrowForOwner("owner-1", UserPermissions.AnnotateMany, updater, transaction);

        expect(findByUserId).toHaveBeenCalledWith("owner-1", transaction);

        expect(wide.update).toHaveBeenCalledWith({permissions: UserPermissions.AnnotateMany}, carriesTransaction);
        expect(compliant.update).not.toHaveBeenCalled();

        expect(create).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            kind: EventLogItemKind.ApiKeyUpdate,
            name: "ApiKeyUpdate",
            targetId: "key-wide",
            parentId: "owner-1",
            userId: "admin-1",
            details: {permissions: UserPermissions.AnnotateMany, previousPermissions: UserPermissions.AnnotateMany | UserPermissions.PublishReview}
        }), carriesTransaction);
    });

    test("keeps a key narrowed to nothing", async () => {
        const apiKey = keyStub("key-1", UserPermissions.EditAll | UserPermissions.TeamReview);
        const {create} = stubKeys([apiKey]);

        await ApiKey.narrowForOwner("owner-1", UserPermissions.Admin, updater, transaction);

        expect(apiKey.update).toHaveBeenCalledWith({permissions: UserPermissions.None}, carriesTransaction);
        expect(apiKey.destroy).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            kind: EventLogItemKind.ApiKeyUpdate,
            details: {permissions: UserPermissions.None, previousPermissions: UserPermissions.EditAll | UserPermissions.TeamReview}
        }), carriesTransaction);
    });

    test("a failed key update reaches the caller", async () => {
        const apiKey = keyStub("key-1", UserPermissions.AnnotateMany | UserPermissions.PublishReview);
        const failure = new Error("update failed");
        apiKey.update = vi.fn().mockRejectedValue(failure);
        stubKeys([apiKey]);

        await expect(ApiKey.narrowForOwner("owner-1", UserPermissions.AnnotateMany, updater, transaction)).rejects.toBe(failure);
    });

    test("an owner with no keys writes nothing", async () => {
        const {create} = stubKeys([]);

        await ApiKey.narrowForOwner("owner-1", UserPermissions.None, updater, transaction);

        expect(create).not.toHaveBeenCalled();
    });
});
