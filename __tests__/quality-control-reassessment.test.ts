import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {QualityControl} = require("../src/models/qualityControl");
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
    nodeCounts?: object;
    existingQualityControl?: boolean;
};

function stub(status: number, options: Options = {}) {
    const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    Object.defineProperty(QualityControl, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    const atlasReconstruction = {
        id: "atlas-1",
        nodeCounts: "nodeCounts" in options ? options.nodeCounts : {},
        update: vi.fn().mockResolvedValue(undefined)
    };

    const existing = {id: "qc-1", makePending: vi.fn().mockResolvedValue(undefined)};

    return {
        atlasReconstruction: atlasReconstruction,
        existing: existing,
        create: create,
        findReconstruction: vi.spyOn(Reconstruction, "findByPk").mockResolvedValue({id: "reconstruction-1", status: status} as any),
        findAtlas: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any),
        findQualityControl: vi.spyOn(QualityControl, "findOne").mockResolvedValue((options.existingQualityControl ?? true) ? existing as any : null),
        createForReconstruction: vi.spyOn(QualityControl, "createForReconstruction").mockResolvedValue({id: "qc-new"} as any)
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (QualityControl as any).sequelize;
});

describe("requestReassessment authorization", () => {
    test("refuses a user without canModifyReconstruction", async () => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction);

        await expect(QualityControl.requestReassessment(userWith(UserPermissions.PeerReview), "reconstruction-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.findReconstruction).not.toHaveBeenCalled();
    });
});

describe("requestReassessment at PublishReview", () => {
    // Quality control run by hand, before the approval that would normally create the row.
    test("creates the row without touching the child's status", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, {existingQualityControl: false});

        const qualityControl = await QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(qualityControl.id).toBe("qc-new");
        expect(stubs.createForReconstruction).toHaveBeenCalledWith(expect.anything(), "atlas-1", transaction);
        expect(stubs.atlasReconstruction.update).not.toHaveBeenCalled();
    });

    test("makes an existing row pending without touching the child's status or recording the request event", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview);

        const qualityControl = await QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(qualityControl).toBe(stubs.existing);
        expect(stubs.existing.makePending).toHaveBeenCalledTimes(1);
        expect(stubs.atlasReconstruction.update).not.toHaveBeenCalled();
        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("refuses before the atlas reconstruction data has been uploaded", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, {nodeCounts: null});

        await expect(QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow(/before the atlas reconstruction data/);

        expect(stubs.createForReconstruction).not.toHaveBeenCalled();
        expect(stubs.existing.makePending).not.toHaveBeenCalled();
    });
});

describe("requestReassessment at WaitingForAtlasReconstruction", () => {
    test("makes the row pending, resets the child and records the request", async () => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction);

        const qualityControl = await QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(qualityControl).toBe(stubs.existing);
        expect(stubs.existing.makePending).toHaveBeenCalledTimes(1);
        expect(stubs.atlasReconstruction.update).toHaveBeenCalledWith(
            {status: AtlasReconstructionStatus.PendingQualityControl},
            {transaction: transaction}
        );
        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.AtlasReconstructionQualityControlRequest});
    });
});

describe("requestReassessment refused statuses", () => {
    test.each([
        ReconstructionStatus.InProgress,
        ReconstructionStatus.OnHold,
        ReconstructionStatus.PeerReview,
        ReconstructionStatus.Approved,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Rejected,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived
    ])("refuses %s", async (status: number) => {
        const stubs = stub(status);

        await expect(QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow(/Cannot request quality control/);

        expect(stubs.existing.makePending).not.toHaveBeenCalled();
        expect(stubs.createForReconstruction).not.toHaveBeenCalled();
    });

    test("refuses a reconstruction that does not exist", async () => {
        stub(ReconstructionStatus.PublishReview);
        vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(null);

        await expect(QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow(/Reconstruction not found/);
    });

    test("refuses a reconstruction with no atlas child", async () => {
        stub(ReconstructionStatus.PublishReview);
        vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(null);

        await expect(QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow(/No atlas reconstruction found/);
    });
});

describe("requestReassessment serialization", () => {
    test("locks the atlas row for the transaction before looking the quality control row up", async () => {
        const stubs = stub(ReconstructionStatus.WaitingForAtlasReconstruction);

        await QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.findAtlas).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        expect(stubs.findAtlas.mock.invocationCallOrder[0])
            .toBeLessThan(stubs.findQualityControl.mock.invocationCallOrder[0]);
    });

    test("every read and the create run on the one transaction", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, {existingQualityControl: false});

        await QualityControl.requestReassessment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(stubs.findReconstruction).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction});
        expect((stubs.findQualityControl.mock.calls[0][0] as any).transaction).toBe(transaction);
        expect(stubs.createForReconstruction.mock.calls[0][2]).toBe(transaction);
    });
});
