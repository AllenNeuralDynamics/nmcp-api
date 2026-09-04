import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {QualityControl} = require("../src/models/qualityControl");
const {QualityControlStatus} = require("../src/models/qualityControlStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

type Options = {
    existingQualityControl?: boolean;
    qualityControlStatus?: number;
};

function stub(childStatus: number | null, options: Options = {}) {
    const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    Object.defineProperty(AtlasReconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    const atlasReconstruction = childStatus === null ? null : (() => {
        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: childStatus,
            // Populated as a child that failed quality control would be, so the reset is shown to clear them.
            failureReason: "quality control failed 2 test(s): SomaCount, Bifurcations",
            failedAt: new Date("2026-03-01")
        });

        instance.update = vi.fn().mockImplementation(async (update: any) => {
            Object.assign(instance, update);
            return instance;
        });

        return instance;
    })();

    const existing = {
        id: "qc-1",
        status: options.qualityControlStatus ?? QualityControlStatus.Failed,
        makePending: vi.fn().mockResolvedValue(undefined)
    };

    return {
        atlasReconstruction: atlasReconstruction,
        existing: existing,
        create: create,
        findAtlas: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any),
        findQualityControl: vi.spyOn(QualityControl, "findOne").mockResolvedValue((options.existingQualityControl ?? true) ? existing as any : null)
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (AtlasReconstruction as any).sequelize;
});

describe("requestQualityControlReassessment authorization", () => {
    test("refuses a peer reviewer, before any query", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        await expect(AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PeerReview), "reconstruction-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.findAtlas).not.toHaveBeenCalled();
    });

    test.each([
        ["a publish reviewer", UserPermissions.PublishReview],
        ["an admin holding no review bit", UserPermissions.Admin]
    ])("allows %s", async (_label: string, permissions: number) => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        await AtlasReconstruction.requestQualityControlReassessment(userWith(permissions), "reconstruction-1");

        expect(stubs.existing.makePending).toHaveBeenCalledTimes(1);
    });
});

describe("requestQualityControlReassessment from FailedQualityControl", () => {
    test("resets the child, clears the failure metadata and records the request", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        const child = await AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(child.status).toBe(AtlasReconstructionStatus.PendingQualityControl);
        expect(stubs.atlasReconstruction.update).toHaveBeenCalledWith(
            {status: AtlasReconstructionStatus.PendingQualityControl, failureReason: null, failedAt: null},
            {transaction: transaction}
        );
        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.AtlasReconstructionQualityControlRequest, targetId: "atlas-1"});
    });

    // The worker's getPending selects on the quality control row, not on the child, so resetting the child alone would
    // leave the reassessment inert.
    test("makes the quality control row pending on the same transaction", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        await AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.findQualityControl).toHaveBeenCalledWith({where: {reconstructionId: "atlas-1"}, transaction: transaction});
        expect(stubs.existing.makePending).toHaveBeenCalledWith(expect.anything(), transaction);
    });

    // Post-approval the row always exists, because prepareToFinalize creates it.  Its absence is malformed data, not a
    // case to create around.
    test("throws when there is no quality control row", async () => {
        stub(AtlasReconstructionStatus.FailedQualityControl, {existingQualityControl: false});

        await expect(AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow(/No quality control record found/);
    });

    test("locks the atlas row for the transaction before looking the quality control row up", async () => {
        const stubs = stub(AtlasReconstructionStatus.FailedQualityControl);

        await AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.findAtlas).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        expect(stubs.findAtlas.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.findQualityControl.mock.invocationCallOrder[0]);
    });
});

/**
 * The guard is now the child's status rather than the parent's, which is what makes it airtight: a worker only ever
 * holds an In... claim, and none of those is FailedQualityControl.  The pre-approval hand-run from ReadyToProcess is
 * gone with it - quality control runs only as a pipeline phase.
 */
describe("requestQualityControlReassessment refused child statuses", () => {
    const allStatuses: number[] = Object.values(AtlasReconstructionStatus).filter(value => typeof value === "number") as number[];

    test.each(allStatuses.filter(status => status !== AtlasReconstructionStatus.FailedQualityControl))(
        "refuses a child at %s with code 1004",
        async (status: number) => {
            const stubs = stub(status);

            await expect(AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
                .rejects.toMatchObject({extensions: {code: 1004}});

            expect(stubs.atlasReconstruction.update).not.toHaveBeenCalled();
            expect(stubs.existing.makePending).not.toHaveBeenCalled();
        }
    );

    test("refuses a reconstruction with no atlas child", async () => {
        stub(null);

        await expect(AtlasReconstruction.requestQualityControlReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow(/No atlas reconstruction found/);
    });
});
