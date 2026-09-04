import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"};

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function stub(status: number, user: any) {
    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    // Model.sequelize is a readonly static assigned during init(), which never runs here, so define it rather than
    // assign it.  The callback form hands the sentinel transaction to the method under test.
    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    return {
        reconstruction: reconstruction,
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("updateMetadata", () => {
    test("writes notes when notes is the only argument", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1", notes: "abc"});

        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({notes: "abc"});
    });

    test("does not touch notes when only started is supplied", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        const started = new Date("2026-01-02T03:04:05Z");

        await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1", started: started});

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({startedAt: started});
    });

    test("writes both when notes and started are supplied", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        const started = new Date("2026-01-02T03:04:05Z");

        await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1", notes: "abc", started: started});

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({notes: "abc", startedAt: started});
    });

    test("an explicit null clears notes", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1", notes: null});

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({notes: ""});
    });

    test("duration is written to durationHours", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1", duration: 4});

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({durationHours: 4});
    });

    test("completed is written to completedAt", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        const completed = new Date("2026-02-03T04:05:06Z");

        await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1", completed: completed});

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({completedAt: completed});
    });

    test("no arguments writes nothing", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.PublishReview));

        const result = await Reconstruction.updateMetadata("user-1", {reconstructionId: "reconstruction-1"});

        expect(result).toBeUndefined();
        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("refuses a user without publish review", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await expect(Reconstruction.updateMetadata("annotator-1", {reconstructionId: "reconstruction-1", notes: "abc"}))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("requestReview", () => {
    const annotator = () => userWith(UserPermissions.AnnotateOne, "annotator-1");

    const args = (extra: object = {}) => ({
        reconstructionId: "reconstruction-1",
        targetStatus: ReconstructionStatus.PeerReview,
        ...extra
    });

    test("duration is written to durationHours", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await Reconstruction.requestReview(args({duration: 4}), "annotator-1");

        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({
            status: ReconstructionStatus.PeerReview,
            completedAt: expect.any(Date),
            durationHours: 4
        });
    });

    test("the payload carries no duration key", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await Reconstruction.requestReview(args({duration: 4}), "annotator-1");

        expect(stubs.reconstruction.update.mock.calls[0][0]).not.toHaveProperty("duration");
    });

    test("a zero duration is written rather than treated as absent", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await Reconstruction.requestReview(args({duration: 0}), "annotator-1");

        expect(stubs.reconstruction.update.mock.calls[0][0]).toMatchObject({durationHours: 0});
    });

    test("no duration writes neither key", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await Reconstruction.requestReview(args(), "annotator-1");

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({
            status: ReconstructionStatus.PeerReview,
            completedAt: expect.any(Date)
        });
    });

    test("notes are unaffected", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await Reconstruction.requestReview(args({notes: "abc"}), "annotator-1");

        expect(stubs.reconstruction.update.mock.calls[0][0]).toMatchObject({notes: "abc"});
    });

    test("the recorded event details carry durationHours", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await Reconstruction.requestReview(args({duration: 4}), "annotator-1");

        expect(stubs.create).toHaveBeenCalledTimes(1);

        const details = (stubs.create.mock.calls[0][0] as any).details;

        expect(details).toMatchObject({durationHours: 4});
        expect(details).not.toHaveProperty("duration");
        expect((stubs.create.mock.calls[0][0] as any).kind).toBe(EventLogItemKind.ReconstructionRequestPeerReview);
    });

    test("refuses a target status that is not a review state", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, annotator());

        await expect(Reconstruction.requestReview(args({targetStatus: ReconstructionStatus.Approved}), "annotator-1"))
            .rejects.toThrow(/Peer Review or Publish Review/);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});
