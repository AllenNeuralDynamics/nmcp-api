import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, ReviewRequestSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {EventLogItem} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

// Model.prototype.update mutates in place, and the guards read this.status, so the stub has to assign onto itself.
function reconstructionStub(status: number, atlasReconstruction: any = null) {
    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.annotatorId = "annotator-1";
    reconstruction.status = status;
    reconstruction.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(reconstruction, update);
        return reconstruction;
    });
    reconstruction.getAtlasReconstruction = vi.fn().mockResolvedValue(atlasReconstruction);
    return reconstruction;
}

function stub(status: number, user: any, atlasReconstruction: any = null) {
    const reconstruction = reconstructionStub(status, atlasReconstruction);

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    // Model.sequelize is a readonly static assigned during init(), which never runs here, so define it rather than
    // assign it.  The callback form has to invoke its callback.
    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
        configurable: true,
        writable: true
    });

    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    return reconstruction;
}

const allStatuses = Object.keys(ReconstructionStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => ReconstructionStatus[key] as number);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("requestReview source statuses", () => {
    const targets = [ReconstructionStatus.PeerReview, ReconstructionStatus.PublishReview];

    for (const targetStatus of targets) {
        test.each(ReviewRequestSourceStatuses as number[])(`allows source status %s for target ${ReconstructionStatus[targetStatus]}`, async (status: number) => {
            stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

            const updated = await Reconstruction.requestReview({reconstructionId: "reconstruction-1", targetStatus}, "annotator-1");

            expect(updated.status).toBe(targetStatus);
        });
    }

    test.each(allStatuses.filter(status => !(ReviewRequestSourceStatuses as number[]).includes(status)))(
        "refuses source status %s even for an admin",
        async (status: number) => {
            const reconstruction = stub(status, userWith(UserPermissions.Admin));

            await expect(Reconstruction.requestReview({
                reconstructionId: "reconstruction-1",
                targetStatus: ReconstructionStatus.PeerReview
            }, "user-1")).rejects.toThrow(/Cannot request a review/);

            expect(reconstruction.update).not.toHaveBeenCalled();
        });

    test("refuses a target that is not a review status", async () => {
        stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await expect(Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.Approved
        }, "user-1")).rejects.toThrow(/Peer Review or Publish Review/);
    });
});

describe("requestReview authorization", () => {
    test("allows an admin on someone else's reconstruction", async () => {
        const reconstruction = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "user-1");

        expect(reconstruction.status).toBe(ReconstructionStatus.PublishReview);
    });

    test("allows the annotator to ask for publish review directly", async () => {
        const reconstruction = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "annotator-1");

        expect(reconstruction.status).toBe(ReconstructionStatus.PublishReview);
    });

    // The route A5 removes: a peer reviewer promoting someone else's reconstruction out of peer review.
    test("refuses a peer reviewer asking for publish review from peer review, on permission and on status", async () => {
        const reconstruction = stub(ReconstructionStatus.PeerReview, userWith(UserPermissions.PeerReview, "reviewer-1"));

        await expect(Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "reviewer-1")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(reconstruction.update).not.toHaveBeenCalled();

        // And with the permission problem removed, the source status still refuses it.
        vi.restoreAllMocks();

        const admin = stub(ReconstructionStatus.PeerReview, userWith(UserPermissions.Admin));

        await expect(Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "user-1")).rejects.toThrow(/Cannot request a review/);

        expect(admin.update).not.toHaveBeenCalled();
    });
});

describe("requestReview under disregardAuth", () => {
    // The import's first run: InProgress, no review permissions, not the annotator.
    test("allows InProgress to PublishReview", async () => {
        const reconstruction = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.None, "importer-1"));

        await Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "importer-1", null, true);

        expect(reconstruction.status).toBe(ReconstructionStatus.PublishReview);
    });

    // The import's re-run over a row it already moved.
    test("allows PublishReview to PublishReview", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.None, "importer-1"));

        await Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "importer-1", null, true);

        expect(reconstruction.update).toHaveBeenCalledTimes(1);
    });
});

describe("approveReconstruction source statuses", () => {
    function atlasStub(advances: boolean) {
        return {approve: vi.fn().mockResolvedValue(advances)};
    }

    test("allows PeerReview to PublishReview", async () => {
        const reconstruction = stub(ReconstructionStatus.PeerReview, userWith(UserPermissions.Admin));

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.PublishReview, "user-1");

        expect(updated.status).toBe(ReconstructionStatus.PublishReview);
        expect(reconstruction.reviewerId).toBe("user-1");
    });

    test("allows PublishReview to Approved", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin), atlasStub(true));

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1");

        expect(updated.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
    });

    test.each(allStatuses.filter(status => status !== ReconstructionStatus.PeerReview))(
        "refuses source status %s for target PublishReview even for an admin",
        async (status: number) => {
            const reconstruction = stub(status, userWith(UserPermissions.Admin));

            await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.PublishReview, "user-1"))
                .rejects.toThrow(/Cannot approve a reconstruction/);

            expect(reconstruction.update).not.toHaveBeenCalled();
        });

    test.each(allStatuses.filter(status => status !== ReconstructionStatus.PublishReview))(
        "refuses source status %s for target Approved even for an admin",
        async (status: number) => {
            const reconstruction = stub(status, userWith(UserPermissions.Admin), atlasStub(true));

            await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1"))
                .rejects.toThrow(/Cannot approve a reconstruction/);

            expect(reconstruction.update).not.toHaveBeenCalled();
        });

    test.each([
        ReconstructionStatus.InProgress,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Published
    ])("refuses target status %s, which is not an approval target at all", async (targetStatus: number) => {
        stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await expect(Reconstruction.approveReconstruction("reconstruction-1", targetStatus, "user-1"))
            .rejects.toThrow(/not supported/);
    });

    // B1's premise: a portal approval that cannot start the automatic phases waits at Approved rather than failing.
    test("leaves the row at Approved when the child cannot advance, without refusing", async () => {
        stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin), atlasStub(false));

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1");

        expect(updated.status).toBe(ReconstructionStatus.Approved);
    });
});

describe("approveReconstruction under disregardAuth", () => {
    test("still refuses the PublishReview target", async () => {
        stub(ReconstructionStatus.PeerReview, userWith(UserPermissions.None, "importer-1"));

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.PublishReview, "importer-1", null, true))
            .rejects.toBeInstanceOf(UnauthorizedError);
    });

    test("succeeds from any source status when the child advances", async () => {
        const reconstruction = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.None, "importer-1"), {
            approve: vi.fn().mockResolvedValue(true)
        });

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "importer-1", null, true);

        expect(updated.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
    });

    // A7: an import has no deferred upload to wait for, so an unadvanced approval is a failure and the transaction
    // rolls back the writes it made.
    test("throws when the child cannot advance, rather than leaving the row at Approved", async () => {
        stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.None, "importer-1"), {
            approve: vi.fn().mockResolvedValue(false)
        });

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "importer-1", null, true))
            .rejects.toThrow(/cannot be approved before its atlas reconstruction data/);
    });
});
