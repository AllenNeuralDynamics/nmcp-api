import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, DiscardableSourceStatuses, AdminDiscardableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenNode} = require("../src/models/specimenNode");
const {EventLogItem} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

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
    reconstruction.destroy = vi.fn();

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
        configurable: true,
        writable: true
    });

    return {
        reconstruction: reconstruction,
        discardForReconstruction: vi.spyOn(AtlasReconstruction, "discardForReconstruction").mockResolvedValue(undefined),
        destroyNodes: vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0),
        create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("discardReconstruction as the annotator", () => {
    test.each(DiscardableSourceStatuses as number[])("discards from %s", async (status: number) => {
        stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "annotator-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });

    test.each(AdminDiscardableSourceStatuses as number[])("is refused at %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await expect(Reconstruction.discardReconstruction("reconstruction-1", "annotator-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
    });
});

describe("discardReconstruction as an admin", () => {
    test.each([...DiscardableSourceStatuses, ...AdminDiscardableSourceStatuses] as number[])("discards from %s", async (status: number) => {
        stub(status, userWith(UserPermissions.Admin));

        const discarded = await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(discarded.status).toBe(ReconstructionStatus.Discarded);
    });
});

describe("discardReconstruction refused statuses", () => {
    // The status problem is reported as such rather than as Unauthorized, whoever is asking.
    test.each([
        ReconstructionStatus.Approved,
        ReconstructionStatus.WaitingForAtlasReconstruction,
        ReconstructionStatus.ReadyToPublish,
        ReconstructionStatus.Publishing,
        ReconstructionStatus.Published,
        ReconstructionStatus.Archived
    ])("refuses %s for everyone, with the status-shaped error", async (status: number) => {
        for (const user of [userWith(UserPermissions.Admin), userWith(UserPermissions.AnnotateOne, "annotator-1")]) {
            vi.restoreAllMocks();

            const stubs = stub(status, user);

            await expect(Reconstruction.discardReconstruction("reconstruction-1", user.id))
                .rejects.toThrow(/Cannot discard a reconstruction/);

            expect(stubs.reconstruction.destroy).not.toHaveBeenCalled();
        }
    });
});

describe("discardReconstruction teardown", () => {
    test("soft-deletes the reconstruction and everything downstream of it", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        await Reconstruction.discardReconstruction("reconstruction-1", "annotator-1");

        expect(stubs.discardForReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.destroyNodes).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.destroy).toHaveBeenCalledTimes(1);
    });

    test("still tears down on the admin-only route", async () => {
        const stubs = stub(ReconstructionStatus.PublishReview, userWith(UserPermissions.Admin));

        await Reconstruction.discardReconstruction("reconstruction-1", "user-1");

        expect(stubs.discardForReconstruction).toHaveBeenCalledTimes(1);
        expect(stubs.destroyNodes).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.destroy).toHaveBeenCalledTimes(1);
    });
});
