import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction, PausableSourceStatuses, ResumableSourceStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
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

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
    vi.spyOn(User, "findUserOrId").mockResolvedValue(user);

    Object.defineProperty(Reconstruction, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback({}))},
        configurable: true,
        writable: true
    });

    return {reconstruction, create: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"})};
}

const allStatuses = Object.keys(ReconstructionStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => ReconstructionStatus[key] as number);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

// The three hold setters share one implementation and are held to one specification.
const holdSetters = [
    {method: "pauseReconstruction", status: ReconstructionStatus.OnHold, kind: EventLogItemKind.ReconstructionPause, refusal: /Cannot pause/},
    {method: "markIncomplete", status: ReconstructionStatus.Incomplete, kind: EventLogItemKind.ReconstructionIncomplete, refusal: /as incomplete/},
    {method: "markDuplicate", status: ReconstructionStatus.Duplicate, kind: EventLogItemKind.ReconstructionDuplicate, refusal: /as a duplicate/}
];

const nonPausableStatuses = allStatuses.filter(status => !(PausableSourceStatuses as number[]).includes(status));

describe.each(holdSetters)("$method", ({method, status: holdStatus, kind, refusal}) => {
    test.each(PausableSourceStatuses as number[])("allows source status %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const updated = await Reconstruction[method]("reconstruction-1", "annotator-1");

        expect(updated.status).toBe(holdStatus);
        expect(stubs.reconstruction.update).toHaveBeenCalledWith({status: holdStatus}, expect.anything());
    });

    test.each(nonPausableStatuses)("refuses source status %s even for an admin", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Reconstruction[method]("reconstruction-1", "user-1")).rejects.toThrow(refusal);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    // There are no direct moves between holds: a held reconstruction resumes first.
    test.each(ResumableSourceStatuses as number[])("refuses a reconstruction already held at %s - resume first", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await expect(Reconstruction[method]("reconstruction-1", "user-1")).rejects.toThrow(refusal);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("refuses another annotator", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.AnnotateOne, "annotator-2"));

        await expect(Reconstruction[method]("reconstruction-1", "annotator-2")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("allows an admin who is not the annotator", async () => {
        stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        const updated = await Reconstruction[method]("reconstruction-1", "user-1");

        expect(updated.status).toBe(holdStatus);
    });

    // disregardAuth buys the import tools out of the permission and nothing else: the source list holds for them
    // exactly as it does for the portal.  The importer here holds no permission and is not the annotator.
    test.each(PausableSourceStatuses as number[])("disregardAuth bypasses the predicate but not the source list, from %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.None, "importer-1"));

        const updated = await Reconstruction[method]("reconstruction-1", "importer-1", null, true);

        expect(updated.status).toBe(holdStatus);
        expect(stubs.reconstruction.update).toHaveBeenCalledTimes(1);
    });

    test.each(nonPausableStatuses)("refuses source status %s under disregardAuth", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.None, "importer-1"));

        await expect(Reconstruction[method]("reconstruction-1", "importer-1", null, true)).rejects.toThrow(refusal);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });

    test("records its own event kind, and only that one", async () => {
        const stubs = stub(ReconstructionStatus.InProgress, userWith(UserPermissions.Admin));

        await Reconstruction[method]("reconstruction-1", "user-1");

        expect(stubs.create.mock.calls).toHaveLength(1);
        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: kind});
    });
});

describe("resumeReconstruction", () => {
    test.each(ResumableSourceStatuses as number[])("allows %s and writes InProgress", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.AnnotateOne, "annotator-1"));

        const updated = await Reconstruction.resumeReconstruction("reconstruction-1", "annotator-1");

        expect(updated.status).toBe(ReconstructionStatus.InProgress);
        expect(stubs.reconstruction.update).toHaveBeenCalledWith({status: ReconstructionStatus.InProgress}, expect.anything());
    });

    test.each(allStatuses.filter(status => !(ResumableSourceStatuses as number[]).includes(status)))(
        "refuses source status %s even for an admin",
        async (status: number) => {
            const stubs = stub(status, userWith(UserPermissions.Admin));

            await expect(Reconstruction.resumeReconstruction("reconstruction-1", "user-1")).rejects.toThrow(/Cannot resume/);

            expect(stubs.reconstruction.update).not.toHaveBeenCalled();
        });

    test.each(ResumableSourceStatuses as number[])("records the resume event from %s", async (status: number) => {
        const stubs = stub(status, userWith(UserPermissions.Admin));

        await Reconstruction.resumeReconstruction("reconstruction-1", "user-1");

        expect(stubs.create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.ReconstructionResume});
    });

    test("refuses another annotator", async () => {
        const stubs = stub(ReconstructionStatus.OnHold, userWith(UserPermissions.AnnotateOne, "annotator-2"));

        await expect(Reconstruction.resumeReconstruction("reconstruction-1", "annotator-2")).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.reconstruction.update).not.toHaveBeenCalled();
    });
});
