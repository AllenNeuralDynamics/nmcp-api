import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op, Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Neuron} = require("../src/models/neuron");
const {Specimen} = require("../src/models/specimen");
const {Atlas} = require("../src/models/atlas");
const {EventLogItem} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

const structureAtlases = new Map<string, string>([["structure-1a", "atlas-1"], ["structure-2a", "atlas-2"]]);

const liveSpecimenAtlases = new Map<string, string>([["specimen-1", "atlas-1"], ["specimen-2", "atlas-1"], ["specimen-3", "atlas-2"]]);

const deletedSpecimenAtlases = new Map<string, string>([["deleted-1", "atlas-1"], ["deleted-2", "atlas-2"]]);

function editor() {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    user.permissions = UserPermissions.Edit;
    return user;
}

function prototypeStub(model: any, properties: object = {}) {
    const instance = Object.create(model.prototype);
    Object.assign(instance, {id: "instance-1"}, properties);
    instance.update = vi.fn().mockImplementation(async (update: any) => Object.assign(instance, update));
    return instance;
}

function stubCommon() {
    Object.defineProperty(Neuron, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    vi.spyOn(Atlas, "getAtlasForStructure").mockImplementation((structureId: any) => {
        const atlasId = structureAtlases.get(structureId);
        return atlasId ? {id: atlasId} : null;
    });

    // findAtlasId reads past paranoid, so deleted specimens resolve too, as they do in the database.
    const allSpecimenAtlases = new Map([...liveSpecimenAtlases, ...deletedSpecimenAtlases]);

    return vi.spyOn(Specimen, "findAtlasId").mockImplementation(async (specimenId: any) => allSpecimenAtlases.get(specimenId) ?? null);
}

// The paranoid default: only live specimens are found.
function liveSpecimen(specimenId: string) {
    const atlasId = liveSpecimenAtlases.get(specimenId);

    return atlasId ? {id: specimenId, atlasId} : null;
}

function lockedCalls(findByPk: any): any[] {
    return findByPk.mock.calls.filter((call: any) => call[1]?.lock);
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Neuron as any).sequelize;
});

describe("neuron creation", () => {
    function stubCreate() {
        stubCommon();

        const findByPk = vi.spyOn(Specimen, "findByPk").mockResolvedValue({id: "specimen-1", atlasId: "atlas-1"});
        vi.spyOn(Neuron, "findAll").mockResolvedValue([]);

        const create = vi.spyOn(Neuron, "create").mockImplementation(async (shape: any) => prototypeStub(Neuron, shape));

        return Object.assign(create, {findByPk});
    }

    test("locks its specimen in the write transaction", async () => {
        const create = stubCreate();

        await Neuron.createOrUpdateForShape({label: "N002", specimenId: "specimen-1"}, editor(), {allowCreate: true});

        const locked = lockedCalls(create.findByPk);

        expect(locked).toHaveLength(1);
        expect(locked[0]).toEqual(["specimen-1", {transaction, lock: Transaction.LOCK.SHARE}]);

        const lockOrder = create.findByPk.mock.invocationCallOrder[create.findByPk.mock.calls.indexOf(locked[0])];

        expect(lockOrder).toBeLessThan(create.mock.invocationCallOrder[0]);
    });

    test("refuses a specimen deleted before its lock", async () => {
        const create = stubCreate();

        // The locked re-read finds nothing, as when a delete committed while the create waited.
        create.findByPk.mockImplementation(async (_: any, options: any) => options?.lock ? null : {id: "specimen-1", atlasId: "atlas-1"});

        await expect(Neuron.createOrUpdateForShape({label: "N002", specimenId: "specimen-1"}, editor(), {allowCreate: true}))
            .rejects.toThrow(/specimen can not be found/);

        expect(create).not.toHaveBeenCalled();
    });

    test("accepts a structure from the specimen's atlas", async () => {
        const create = stubCreate();

        await Neuron.createOrUpdateForShape({label: "N002", specimenId: "specimen-1", atlasStructureId: "structure-1a"}, editor(), {allowCreate: true});

        expect(create).toHaveBeenCalledWith(expect.objectContaining({atlasStructureId: "structure-1a"}), expect.anything());
    });

    test("refuses a structure from another atlas", async () => {
        const create = stubCreate();

        await expect(Neuron.createOrUpdateForShape({label: "N002", specimenId: "specimen-1", atlasStructureId: "structure-2a"}, editor(), {allowCreate: true}))
            .rejects.toThrow(/does not belong to the specimen's atlas/);

        expect(create).not.toHaveBeenCalled();
    });

    test("refuses an unknown structure", async () => {
        const create = stubCreate();

        await expect(Neuron.createOrUpdateForShape({label: "N002", specimenId: "specimen-1", atlasStructureId: "structure-unknown"}, editor(), {allowCreate: true}))
            .rejects.toThrow(/atlas structure can not be found/);

        expect(create).not.toHaveBeenCalled();
    });
});

describe("neuron update", () => {
    function stubUpdate(specimenId: string = "specimen-1") {
        const findAtlasId = stubCommon();

        const findByPk = vi.spyOn(Specimen, "findByPk").mockImplementation(async (id: any) => liveSpecimen(id));

        const neuron = prototypeStub(Neuron, {id: "neuron-1", label: "N001", specimenId});

        vi.spyOn(Neuron, "findByPk").mockResolvedValue(neuron);

        return {neuron, findAtlasId, findByPk};
    }

    test("refuses a move to a soft-deleted specimen", async () => {
        const stubs = stubUpdate();

        await expect(Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "deleted-1"}, editor()))
            .rejects.toThrow(/specimen can not be found/);

        expect(stubs.neuron.update).not.toHaveBeenCalled();
    });

    test("accepts a move off a soft-deleted specimen", async () => {
        const stubs = stubUpdate("deleted-1");

        await Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-2"}, editor());

        expect(stubs.neuron.update).toHaveBeenCalledWith(expect.objectContaining({specimenId: "specimen-2"}), expect.anything());
    });

    test("looks the target up with the paranoid default", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-2"}, editor());

        expect(stubs.findByPk.mock.calls.length).toBeGreaterThan(0);

        for (const [id, options] of stubs.findByPk.mock.calls) {
            expect(id).toBe("specimen-2");
            expect(options).not.toHaveProperty("paranoid");
        }
    });

    test("locks the target in the write transaction", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-2"}, editor());

        const locked = lockedCalls(stubs.findByPk);

        expect(locked).toHaveLength(1);
        expect(locked[0]).toEqual(["specimen-2", {transaction, lock: Transaction.LOCK.SHARE}]);

        const lockOrder = stubs.findByPk.mock.invocationCallOrder[stubs.findByPk.mock.calls.indexOf(locked[0])];

        expect(lockOrder).toBeLessThan(stubs.neuron.update.mock.invocationCallOrder[0]);
    });

    test("refuses a target deleted before its lock", async () => {
        const stubs = stubUpdate();

        // The locked re-read finds nothing, as when a delete committed while the move waited.
        stubs.findByPk.mockImplementation(async (id: any, options: any) => options?.lock ? null : liveSpecimen(id));

        await expect(Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-2"}, editor()))
            .rejects.toThrow(/specimen can not be found/);

        expect(stubs.neuron.update).not.toHaveBeenCalled();
    });

    test("takes no lock when the specimen is unchanged", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", atlasStructureId: "structure-1a"}, editor());

        expect(lockedCalls(stubs.findByPk)).toHaveLength(0);
        expect(stubs.neuron.update).toHaveBeenCalled();
    });

    test("refuses a structure from another atlas", async () => {
        const stubs = stubUpdate();

        await expect(Neuron.createOrUpdateForShape({id: "neuron-1", atlasStructureId: "structure-2a"}, editor()))
            .rejects.toThrow(/does not belong to the specimen's atlas/);

        expect(stubs.neuron.update).not.toHaveBeenCalled();
    });

    test("refuses a move to a specimen in another atlas", async () => {
        const stubs = stubUpdate();

        await expect(Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-3"}, editor()))
            .rejects.toThrow(/different atlas/);

        expect(stubs.neuron.update).not.toHaveBeenCalled();
    });

    test("accepts a move to a specimen in the same atlas", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-2"}, editor());

        expect(stubs.neuron.update).toHaveBeenCalledWith(expect.objectContaining({specimenId: "specimen-2"}), expect.anything());
    });

    test("refuses a move to an unknown specimen", async () => {
        const stubs = stubUpdate();

        await expect(Neuron.createOrUpdateForShape({id: "neuron-1", specimenId: "specimen-unknown"}, editor()))
            .rejects.toThrow(/specimen can not be found/);

        expect(stubs.neuron.update).not.toHaveBeenCalled();
    });

    test("checks a structure against the current specimen's atlas when the specimen is unchanged", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", atlasStructureId: "structure-1a"}, editor());

        expect(stubs.findAtlasId).toHaveBeenCalledWith("specimen-1");
        expect(stubs.neuron.update).toHaveBeenCalledWith(expect.objectContaining({atlasStructureId: "structure-1a"}), expect.anything());
    });
});

describe("bulk neuron update", () => {
    // The default scope hides soft-deleted rows; only paranoid: false reaches them, as it would in the database.
    function stubBulk(specimenIds: (string | null)[]) {
        stubCommon();

        const neurons = specimenIds.map((specimenId, idx) => ({id: `neuron-${idx}`, specimenId}));

        vi.spyOn(Neuron, "findAll").mockResolvedValue(neurons);

        vi.spyOn(Specimen, "findAll").mockImplementation(async (options: any) => {
            const ids: string[] = options.where.id[Op.in];

            const visible = options.paranoid === false ? new Map([...liveSpecimenAtlases, ...deletedSpecimenAtlases]) : liveSpecimenAtlases;

            return ids.filter(id => visible.has(id)).map(id => ({id, atlasId: visible.get(id)}));
        });

        const update = vi.spyOn(Neuron, "update").mockResolvedValue([neurons.length]);

        return {neurons, update};
    }

    function updateMany(neurons: any[], atlasStructureId: string = "structure-1a") {
        return Neuron.updateMany(neurons.map(neuron => neuron.id), {atlasStructureId}, editor());
    }

    test("refuses a structure foreign to one of the specimens", async () => {
        const stubs = stubBulk(["specimen-1", "specimen-3"]);

        await expect(updateMany(stubs.neurons)).rejects.toThrow(/does not belong to the specimen's atlas/);

        expect(stubs.update).not.toHaveBeenCalled();
    });

    test("accepts a structure shared by every specimen's atlas", async () => {
        const stubs = stubBulk(["specimen-1", "specimen-2"]);

        await updateMany(stubs.neurons);

        expect(stubs.update).toHaveBeenCalledTimes(1);
    });

    test("checks a soft-deleted specimen in another atlas rather than skipping it", async () => {
        const stubs = stubBulk(["specimen-1", "deleted-2"]);

        await expect(updateMany(stubs.neurons)).rejects.toThrow(/does not belong to the specimen's atlas/);

        expect(stubs.update).not.toHaveBeenCalled();
    });

    test("accepts a soft-deleted specimen in the same atlas rather than refusing it", async () => {
        const stubs = stubBulk(["specimen-1", "deleted-1"]);

        await updateMany(stubs.neurons);

        expect(stubs.update).toHaveBeenCalledTimes(1);
    });

    test("refuses a neuron whose specimen has no row", async () => {
        const stubs = stubBulk(["specimen-1", null]);

        await expect(updateMany(stubs.neurons)).rejects.toThrow(/does not belong to the specimen's atlas/);

        expect(stubs.update).not.toHaveBeenCalled();
    });

    test("refuses an unknown structure even when no neurons match", async () => {
        const stubs = stubBulk([]);

        await expect(updateMany(stubs.neurons, "structure-unknown")).rejects.toThrow(/atlas structure can not be found/);

        expect(stubs.update).not.toHaveBeenCalled();
    });
});
