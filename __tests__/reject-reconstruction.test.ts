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
    const atlasReconstruction = {
        id: "atlas-1",
        reject: vi.fn().mockResolvedValue(undefined)
    };

    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    // Reproduces Model.prototype.update's in-place mutation, which is what made the atlas-side branch unreachable.
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });
    reconstruction.getAtlasReconstruction = vi.fn().mockResolvedValue(atlasReconstruction);

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    return {
        reconstruction: reconstruction,
        atlasReconstruction: atlasReconstruction,
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("rejectReconstruction from publish review", () => {
    test("rejects the atlas reconstruction as well", async () => {
        const user = userWith(UserPermissions.Admin);
        const stubs = stub(ReconstructionStatus.PublishReview, user);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledTimes(1);
        expect(stubs.atlasReconstruction.reject).toHaveBeenCalledWith(user, transaction);
    });

    test("loads the atlas reconstruction through the enclosing transaction", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.reconstruction.getAtlasReconstruction).toHaveBeenCalledWith({transaction: transaction});
    });

    test("does not assign a reviewer", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({status: ReconstructionStatus.Rejected});
    });
});

describe("rejectReconstruction from other allowed sources", () => {
    test("a peer review source assigns the reviewer and leaves the child alone", async () => {
        const user = userWith(UserPermissions.Admin);
        const stubs = stub(ReconstructionStatus.PeerReview, user);

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({
            status: ReconstructionStatus.Rejected,
            reviewerId: user.id
        });
    });

    // Pins the A2 boundary: restoring reachability must not widen the set of source statuses that reach the branch.
    test("a ready-to-publish source leaves the child untouched", async () => {
        const stubs = stub(ReconstructionStatus.ReadyToPublish, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
        expect(stubs.reconstruction.update.mock.calls[0][0]).toEqual({status: ReconstructionStatus.Rejected});
    });

    test.each([
        ["peer review", ReconstructionStatus.PeerReview],
        ["publish review", ReconstructionStatus.PublishReview],
        ["ready to publish", ReconstructionStatus.ReadyToPublish]
    ])("records the reject event for a %s source", async (_label: string, status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await Reconstruction.rejectReconstruction("reconstruction-1", "user-1");

        expect(stubs.create).toHaveBeenCalledTimes(1);
        expect(stubs.create.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.ReconstructionReject,
            targetId: "reconstruction-1"
        });
    });
});

describe("rejectReconstruction refusals", () => {
    test.each([
        ["approved", ReconstructionStatus.Approved],
        ["publishing", ReconstructionStatus.Publishing],
        ["published", ReconstructionStatus.Published],
        ["archived", ReconstructionStatus.Archived],
        ["in progress", ReconstructionStatus.InProgress]
    ])("refuses a %s source even for an admin", async (_label: string, status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "user-1"))
            .rejects.toThrow(/Peer Review or Publish Review/);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        expect(stubs.atlasReconstruction.reject).not.toHaveBeenCalled();
    });

    test("refuses a user with no review permission", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await expect(Reconstruction.rejectReconstruction("reconstruction-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});
