import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, ReviewRequestSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
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
    vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction);
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

    // The import's re-run over a row it already parked: satisfied as a no-op, with nothing written and no event.
    test("treats PublishReview to PublishReview as a no-op", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.None, "importer-1"));

        const result = await Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "importer-1", null, true);

        expect(result).toBe(reconstruction);
        expect(reconstruction.status).toBe(ReconstructionStatus.PublishReview);
        expect(reconstruction.update).not.toHaveBeenCalled();
        expect(EventLogItem.create).not.toHaveBeenCalled();
    });

    // The no-op is the import's alone.  A portal caller asking for a review the reconstruction is already in has made
    // a mistake, and the source list says so.
    test("still refuses PublishReview to PublishReview without disregardAuth", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await expect(Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "user-1")).rejects.toThrow(/Cannot request a review/);

        expect(reconstruction.update).not.toHaveBeenCalled();
    });

    test.each(ReviewRequestSourceStatuses as number[])("bypasses the predicate but not the source-status list, from %s", async (status: number) => {
        const reconstruction = stub(status, userWith(UserPermissions.None, "importer-1"));

        await Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.PublishReview
        }, "importer-1", null, true);

        expect(reconstruction.status).toBe(ReconstructionStatus.PublishReview);
    });

    // PublishReview is excluded because the no-op above answers it; every other status outside the list is refused,
    // which is what stops a re-run rewinding a reconstruction the pipeline has already taken.
    test.each(allStatuses.filter(status => !(ReviewRequestSourceStatuses as number[]).includes(status) && status != ReconstructionStatus.PublishReview))(
        "refuses source status %s under disregardAuth",
        async (status: number) => {
            const reconstruction = stub(status, userWith(UserPermissions.None, "importer-1"));

            await expect(Reconstruction.requestReview({
                reconstructionId: "reconstruction-1",
                targetStatus: ReconstructionStatus.PublishReview
            }, "importer-1", null, true)).rejects.toThrow(/Cannot request a review/);

            expect(reconstruction.update).not.toHaveBeenCalled();
        });

    // The no-op sits after the target validation, not before it: an unsupported target that happens to equal the
    // current status must still throw rather than returning successfully.
    test("refuses an unsupported target that equals the current status", async () => {
        const reconstruction = stub(ReconstructionStatus.Approved, userWith(UserPermissions.None, "importer-1"));

        await expect(Reconstruction.requestReview({
            reconstructionId: "reconstruction-1",
            targetStatus: ReconstructionStatus.Approved
        }, "importer-1", null, true)).rejects.toThrow(/Peer Review or Publish Review/);

        expect(reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("approveReconstruction source statuses", () => {
    // The approval requires the node data now, so what the child carries is nodeCounts rather than a report of whether
    // it managed to start the phases.
    function atlasStub(uploaded: boolean) {
        return {nodeCounts: uploaded ? {axon: {}, dendrite: {}} : null, approve: vi.fn().mockResolvedValue(undefined)};
    }

    test("allows PeerReview to PublishReview", async () => {
        const reconstruction = stub(ReconstructionStatus.PeerReview, userWith(UserPermissions.Admin));

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.PublishReview, "user-1");

        expect(updated.status).toBe(ReconstructionStatus.PublishReview);
        expect(reconstruction.reviewerId).toBe("user-1");
    });

    test("allows PublishReview to Approved, passing straight through to WaitingForAtlasReconstruction", async () => {
        const child = atlasStub(true);

        stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin), child);

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1");

        // Approved is written and rewritten inside the one transaction, so no row ever rests there.
        expect(updated.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
        expect(child.approve).toHaveBeenCalledTimes(1);
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

    // B1 reversed: the wait at Approved is gone, and the atlas upload is required before the approval rather than
    // rescued after it.  Refusing leaves the reconstruction at PublishReview, where the upload, reject and admin
    // discard are all available, so nothing is stranded.
    test("refuses with code 1005 when the child has no node data, writing nothing", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin), atlasStub(false));

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1"))
            .rejects.toMatchObject({extensions: {code: 1005}});

        expect(reconstruction.status).toBe(ReconstructionStatus.PublishReview);
        expect(reconstruction.update).not.toHaveBeenCalled();
    });

    test("refuses with code 1005 when there is no child at all", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin), null);

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1"))
            .rejects.toMatchObject({extensions: {code: 1005}});

        expect(reconstruction.update).not.toHaveBeenCalled();
    });

    // The locked read is what decides, not the instance the caller was handed: a reject can commit in between.
    test("refuses when the locked parent has moved off the required source", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin), atlasStub(true));

        const locked = Object.assign(Object.create(Reconstruction.prototype), reconstruction, {status: ReconstructionStatus.Rejected});
        locked.update = vi.fn();

        vi.spyOn(Reconstruction, "findByPk").mockImplementation(async (...args: any[]) =>
            args[1]?.lock ? locked : reconstruction);

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "user-1"))
            .rejects.toThrow(/Cannot approve a reconstruction/);

        expect(locked.update).not.toHaveBeenCalled();
        expect(reconstruction.update).not.toHaveBeenCalled();
    });
});

describe("approveReconstruction under disregardAuth", () => {
    test("still refuses the PublishReview target", async () => {
        stub(ReconstructionStatus.PeerReview, userWith(UserPermissions.None, "importer-1"));

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.PublishReview, "importer-1", null, true))
            .rejects.toBeInstanceOf(UnauthorizedError);
    });

    test("succeeds from PublishReview, which is where both imports park the reconstruction before approving", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.None, "importer-1"), {
            nodeCounts: {axon: {}, dendrite: {}},
            approve: vi.fn().mockResolvedValue(undefined)
        });

        const updated = await Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "importer-1", null, true);

        expect(updated.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
        expect(reconstruction.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
    });

    /**
     * disregardAuth buys the import out of the permission, never out of the state rule.  An import approving over a
     * rejection that committed between its own requestReview and this call would silently reverse the reviewer.
     */
    test.each([ReconstructionStatus.InProgress, ReconstructionStatus.Rejected, ReconstructionStatus.WaitingForAtlasReconstruction])(
        "is refused from source status %s under the locked check",
        async (status: number) => {
            const reconstruction = stub(status, userWith(UserPermissions.None, "importer-1"), {
                nodeCounts: {axon: {}, dendrite: {}},
                approve: vi.fn().mockResolvedValue(undefined)
            });

            await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "importer-1", null, true))
                .rejects.toThrow(/Cannot approve a reconstruction/);

            expect(reconstruction.update).not.toHaveBeenCalled();
        });

    // A7: an import has nothing to wait for, so an approval it cannot complete is a failure the transaction rolls back.
    // Both imports catch this and record the reconstruction as failed to approve.
    test("throws with code 1005 when the atlas data is not present", async () => {
        const reconstruction = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.None, "importer-1"), {
            nodeCounts: null,
            approve: vi.fn().mockResolvedValue(undefined)
        });

        await expect(Reconstruction.approveReconstruction("reconstruction-1", ReconstructionStatus.Approved, "importer-1", null, true))
            .rejects.toMatchObject({extensions: {code: 1005}});

        expect(reconstruction.update).not.toHaveBeenCalled();
    });
});
