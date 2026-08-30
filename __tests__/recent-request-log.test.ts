import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {User, UserPermissions} = require("../src/models/user");
const {RecentRequestLog} = require("../src/util/recentRequestLog");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWithPermissions(permissions: number) {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    user.permissions = permissions;
    return user;
}

const internal = () => userWithPermissions(UserPermissions.InternalAccess);

function logWith(limit: number, count: number) {
    const log = new RecentRequestLog(limit);

    for (let index = 0; index < count; index++) {
        log.record(`203.0.113.${index}`, "10.0.0.1", "203.0.113.0");
    }

    return log;
}

describe("authorization", () => {
    test.each([
        ["an internal caller", UserPermissions.InternalAccess],
        ["an admin", UserPermissions.Admin]
    ])("allows %s", (_label: string, permissions: number) => {
        expect(logWith(50, 1).recent(userWithPermissions(permissions))).toHaveLength(1);
    });

    test.each([
        ["none", UserPermissions.None],
        ["a publish reviewer", UserPermissions.PublishReview],
        ["an annotator", UserPermissions.AnnotateMany]
    ])("refuses %s", (_label: string, permissions: number) => {
        expect(() => logWith(50, 1).recent(userWithPermissions(permissions))).toThrow(UnauthorizedError);
    });

    test("refuses a null user", () => {
        expect(() => logWith(50, 1).recent(null)).toThrow(UnauthorizedError);
    });
});

describe("retention", () => {
    test("keeps everything below the limit", () => {
        expect(logWith(50, 10).recent(internal())).toHaveLength(10);
    });

    test("holds at the limit once it is passed", () => {
        expect(logWith(50, 130).recent(internal())).toHaveLength(50);
    });

    test("keeps the newest entries and drops the oldest", () => {
        const entries = logWith(3, 10).recent(internal());

        expect(entries.map((entry: any) => entry.address)).toEqual(["203.0.113.9", "203.0.113.8", "203.0.113.7"]);
    });

    test("returns newest first", () => {
        const entries = logWith(50, 3).recent(internal());

        expect(entries.map((entry: any) => entry.address)).toEqual(["203.0.113.2", "203.0.113.1", "203.0.113.0"]);
    });

    test("records nothing when the limit is zero", () => {
        expect(logWith(0, 10).recent(internal())).toEqual([]);
    });

    test("treats a negative limit as disabled rather than growing without bound", () => {
        expect(logWith(-1, 10).recent(internal())).toEqual([]);
    });

    test("hands back a copy, so a later request can not mutate a result already returned", () => {
        const log = logWith(50, 1);

        const entries = log.recent(internal());

        log.record("203.0.113.200", "10.0.0.1", "");

        expect(entries).toHaveLength(1);
    });
});

describe("recorded detail", () => {
    test("keeps the resolved address, the socket peer and the forwarding chain apart", () => {
        const log = new RecentRequestLog(50);

        log.record("203.0.113.9", "10.0.0.1", "203.0.113.9, 198.51.100.7");

        const [entry] = log.recent(internal());

        expect(entry.address).toBe("203.0.113.9");
        expect(entry.socketAddress).toBe("10.0.0.1");
        expect(entry.forwardedFor).toBe("203.0.113.9, 198.51.100.7");
        expect(entry.at).toBeInstanceOf(Date);
    });

    test("joins a repeated forwarding header rather than dropping part of the chain", () => {
        const log = new RecentRequestLog(50);

        log.record("203.0.113.9", "10.0.0.1", ["203.0.113.9", "198.51.100.7"]);

        expect(log.recent(internal())[0].forwardedFor).toBe("203.0.113.9, 198.51.100.7");
    });

    test("represents a missing address and absent header as empty rather than undefined", () => {
        const log = new RecentRequestLog(50);

        log.record(undefined, undefined, undefined);

        const [entry] = log.recent(internal());

        expect(entry.address).toBe("");
        expect(entry.socketAddress).toBe("");
        expect(entry.forwardedFor).toBe("");
    });
});
