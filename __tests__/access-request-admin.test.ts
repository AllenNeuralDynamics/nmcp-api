import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {AccessRequest, AccessRequestStatus, RequestAccessResponse} = require("../src/models/accessRequest");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWith(permissions: number) {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    user.permissions = permissions;
    return user;
}

const admin = () => userWith(UserPermissions.Admin);

// The boundary here is Admin specifically, so the interesting denial is a user who holds real permissions but not
// that one - model-authorization.test.ts already covers the None and null cases.
const nonAdmin = () => userWith(UserPermissions.PublishReview | UserPermissions.AnnotateMany | UserPermissions.Edit);

afterEach(() => {
    vi.restoreAllMocks();
    delete (AccessRequest as any).sequelize;
});

describe("AccessRequest.getAll", () => {
    function stub(totalCount: number = 0, items: any[] = []) {
        return {
            count: vi.spyOn(AccessRequest, "count").mockResolvedValue(totalCount),
            findAll: vi.spyOn(AccessRequest, "findAll").mockResolvedValue(items)
        };
    }

    test("refuses a non-admin without querying", async () => {
        const stubs = stub();

        await expect(AccessRequest.getAll(nonAdmin(), {})).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.count).not.toHaveBeenCalled();
        expect(stubs.findAll).not.toHaveBeenCalled();
    });

    test("applies no status predicate when none is requested", async () => {
        const stubs = stub();

        await AccessRequest.getAll(admin(), {});

        expect((stubs.findAll.mock.calls[0][0] as any).where).toEqual({});
    });

    test.each([
        {label: "an empty list", input: {status: []}},
        {label: "an absent input", input: undefined}
    ])("applies no status predicate for $label", async ({input}) => {
        const stubs = stub();

        await AccessRequest.getAll(admin(), input);

        expect((stubs.findAll.mock.calls[0][0] as any).where).toEqual({});
    });

    test("filters on the requested statuses", async () => {
        const stubs = stub();
        const status = [AccessRequestStatus.Unreviewed, AccessRequestStatus.Pending];

        await AccessRequest.getAll(admin(), {status});

        expect((stubs.findAll.mock.calls[0][0] as any).where.status[Op.in]).toBe(status);
    });

    test("counts against the same predicate it selects with", async () => {
        const stubs = stub();

        await AccessRequest.getAll(admin(), {status: [AccessRequestStatus.Denied]});

        expect((stubs.count.mock.calls[0][0] as any).where).toEqual((stubs.findAll.mock.calls[0][0] as any).where);
    });

    test("returns the total count and the paged items", async () => {
        const items = [{id: "request-1"}];
        stub(7, items);

        const output = await AccessRequest.getAll(admin(), {offset: 0, limit: 5});

        expect(output.totalCount).toBe(7);
        expect(output.offset).toBe(0);
        expect(output.items).toBe(items);
    });

    test("passes offset and limit through to the query", async () => {
        const stubs = stub(20);

        await AccessRequest.getAll(admin(), {offset: 5, limit: 5});

        const options = stubs.findAll.mock.calls[0][0] as any;

        expect(options.offset).toBe(5);
        expect(options.limit).toBe(5);
    });
});

describe("AccessRequest.createRequest throttling", () => {
    const fiveMinutes = 5 * 60 * 1000;

    // The throttle map is module state keyed by address and capped at ten entries, so every test uses its own
    // address to stay independent of the others.
    function caller(ip: string | undefined) {
        const user = Object.create(User.prototype);
        user.id = "anonymous";
        user.ip = ip;
        return user;
    }

    function stub() {
        Object.defineProperty(AccessRequest, "sequelize", {
            value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
            configurable: true,
            writable: true
        });

        vi.spyOn(AccessRequest, "findOne").mockResolvedValue(null);
        vi.spyOn(AccessRequest, "create").mockImplementation(async () => {
            const created = Object.create(AccessRequest.prototype);
            created.id = "request-1";
            return created;
        });
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
    }

    const submit = (ip: string | undefined) => AccessRequest.createRequest(caller(ip), {emailAddress: "someone@example.com"});

    // Only Date is faked; faking timers wholesale would interfere with awaiting the model's promises.
    beforeEach(() => {
        vi.useFakeTimers({toFake: ["Date"]});
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        stub();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("allows the first five attempts and throttles the sixth", async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
            expect(await submit("10.0.0.1")).toBe(RequestAccessResponse.Accepted);
        }

        expect(await submit("10.0.0.1")).toBe(RequestAccessResponse.Throttled);
    });

    test("counts each address separately", async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
            await submit("10.0.0.2");
        }

        expect(await submit("10.0.0.3")).toBe(RequestAccessResponse.Accepted);
    });

    test("stays throttled until the window elapses", async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
            await submit("10.0.0.4");
        }

        vi.setSystemTime(new Date(Date.now() + fiveMinutes - 1000));

        expect(await submit("10.0.0.4")).toBe(RequestAccessResponse.Throttled);
    });

    // The regression: the expiry comparison was inverted, so this branch was unreachable and an address stayed
    // throttled indefinitely once it hit the limit.
    test("resets once the window elapses", async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
            await submit("10.0.0.5");
        }

        vi.setSystemTime(new Date(Date.now() + fiveMinutes + 1000));

        expect(await submit("10.0.0.5")).toBe(RequestAccessResponse.Accepted);
    });

    test("counts the attempt that reopens the window, so five more are not granted on top of it", async () => {
        for (let attempt = 0; attempt < 6; attempt++) {
            await submit("10.0.0.6");
        }

        vi.setSystemTime(new Date(Date.now() + fiveMinutes + 1000));

        // The reopening attempt is the first of the new window, leaving four before the limit is reached again.
        for (let attempt = 0; attempt < 5; attempt++) {
            expect(await submit("10.0.0.6")).toBe(RequestAccessResponse.Accepted);
        }

        expect(await submit("10.0.0.6")).toBe(RequestAccessResponse.Throttled);
    });

    test("retrying inside the window does not push the reset out", async () => {
        const start = Date.now();

        for (let attempt = 0; attempt < 6; attempt++) {
            await submit("10.0.0.7");
        }

        // Under a window measured from the last attempt, each of these would extend the block indefinitely.
        for (let minute = 1; minute <= 4; minute++) {
            vi.setSystemTime(new Date(start + minute * 60 * 1000));
            expect(await submit("10.0.0.7")).toBe(RequestAccessResponse.Throttled);
        }

        vi.setSystemTime(new Date(start + fiveMinutes + 1000));

        expect(await submit("10.0.0.7")).toBe(RequestAccessResponse.Accepted);
    });

    // Anonymous callers all receive the same cached User instance, so the address has to live on the per-request view
    // the app context derives.  Writing it to the instance instead let one caller be counted against another's window.
    test("keeps callers apart when they share a cached user instance", async () => {
        const shared = Object.create(User.prototype);
        shared.id = "anonymous";
        shared.permissions = UserPermissions.None;

        // Both contexts are derived before either resolver reads one, which is the interleaving that made a shared
        // instance misattribute: the second caller's address would have overwritten the first's.
        const first = shared.withRequestAddress("10.0.1.1");
        const second = shared.withRequestAddress("10.0.1.2");

        const submitAs = (user: any) => AccessRequest.createRequest(user, {emailAddress: "someone@example.com"});

        for (let attempt = 0; attempt < 6; attempt++) {
            await submitAs(first);
        }

        expect(await submitAs(first)).toBe(RequestAccessResponse.Throttled);
        expect(await submitAs(second)).toBe(RequestAccessResponse.Accepted);
    });

    test("keeps callers with no remote address in one shared window rather than failing", async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
            expect(await submit(undefined)).toBe(RequestAccessResponse.Accepted);
        }

        expect(await submit(undefined)).toBe(RequestAccessResponse.Throttled);
    });
});

describe("AccessRequest.updateStatus", () => {
    function requestStub() {
        const request = Object.create(AccessRequest.prototype);
        request.id = "request-1";
        request.status = AccessRequestStatus.Unreviewed;
        request.update = vi.fn().mockImplementation(async (update: any) => {
            Object.assign(request, update);
            return request;
        });
        return request;
    }

    function stub(request: any = requestStub()) {
        vi.spyOn(AccessRequest, "findByPk").mockResolvedValue(request);

        // updateStatus uses the callback form of transaction(), so the stub has to invoke the callback.
        // Model.sequelize is a readonly static assigned during init(), which never runs here, so define it.
        Object.defineProperty(AccessRequest, "sequelize", {
            value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
            configurable: true,
            writable: true
        });

        return {
            request: request,
            findByPk: vi.spyOn(AccessRequest, "findByPk").mockResolvedValue(request),
            create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
        };
    }

    test("refuses a non-admin without querying", async () => {
        const stubs = stub();

        await expect(AccessRequest.updateStatus(nonAdmin(), "request-1", AccessRequestStatus.Accepted))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.findByPk).not.toHaveBeenCalled();
        expect(stubs.request.update).not.toHaveBeenCalled();
    });

    test("rejects a status integer outside the enum without querying", async () => {
        const stubs = stub();

        await expect(AccessRequest.updateStatus(admin(), "request-1", 42)).rejects.toThrow(/not a valid access request status/);

        expect(stubs.findByPk).not.toHaveBeenCalled();
    });

    test("accepts Unreviewed, whose value is zero", async () => {
        const stubs = stub();

        await AccessRequest.updateStatus(admin(), "request-1", AccessRequestStatus.Unreviewed);

        expect(stubs.request.update).toHaveBeenCalledTimes(1);
    });

    test("rejects an id that matches no request", async () => {
        const stubs = stub(null);

        await expect(AccessRequest.updateStatus(admin(), "missing-1", AccessRequestStatus.Accepted))
            .rejects.toThrow(/No such access request missing-1/);

        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("records the status and attributes the acting admin", async () => {
        const stubs = stub();

        const updated = await AccessRequest.updateStatus(admin(), "request-1", AccessRequestStatus.Accepted);

        expect(stubs.request.update).toHaveBeenCalledWith(
            {status: AccessRequestStatus.Accepted, adminId: "user-1"},
            expect.anything()
        );
        expect(updated.status).toBe(AccessRequestStatus.Accepted);
    });

    // A denial is attributable the same way an approval is, so each terminal move gets its own event kind.
    test.each([
        {status: AccessRequestStatus.Accepted, kind: "AccessRequestApprove"},
        {status: AccessRequestStatus.Denied, kind: "AccessRequestDeny"},
        {status: AccessRequestStatus.Pending, kind: "AccessRequestUpdate"},
        {status: AccessRequestStatus.Unreviewed, kind: "AccessRequestUpdate"}
    ])("logs $kind when moving to $status", async ({status, kind}) => {
        const stubs = stub();

        await AccessRequest.updateStatus(admin(), "request-1", status);

        expect(stubs.create).toHaveBeenCalledTimes(1);
        expect(stubs.create.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind[kind],
            name: kind,
            targetId: "request-1",
            userId: "user-1"
        });
    });
});
