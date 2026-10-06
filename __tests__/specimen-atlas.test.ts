import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Specimen} = require("../src/models/specimen");
const {Atlas} = require("../src/models/atlas");
const {EventLogItem} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

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

function stubSpecimens(options: {stored?: object} = {}) {
    Object.defineProperty(Specimen, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

    vi.spyOn(Atlas, "getAtlas").mockImplementation((atlasId: any) => atlasId === "atlas-1" ? {id: "atlas-1"} : undefined);

    const create = vi.spyOn(Specimen, "create").mockImplementation(async (shape: any) => prototypeStub(Specimen, shape));

    const stored = prototypeStub(Specimen, {id: "specimen-1", label: "S001", collectionId: "collection-1", atlasId: "atlas-1", ...options.stored});

    vi.spyOn(Specimen, "findByPk").mockImplementation(async (id: any) => id === "specimen-1" ? stored : null);
    vi.spyOn(Specimen, "findOne").mockResolvedValue(stored);

    return {create, stored};
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Specimen as any).sequelize;
});

describe("specimen creation", () => {
    const allowCreate = {allowCreate: true};

    test("requires an atlas", async () => {
        const stubs = stubSpecimens();

        await expect(Specimen.createOrUpdateForShape({label: "S002", collectionId: "collection-1"}, editor(), allowCreate))
            .rejects.toThrow(/An atlas is required/);

        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("requires a loaded atlas", async () => {
        const stubs = stubSpecimens();

        await expect(Specimen.createOrUpdateForShape({label: "S002", collectionId: "collection-1", atlasId: "atlas-missing"}, editor(), allowCreate))
            .rejects.toThrow(/requested atlas can not be found/);

        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("creates the specimen in the requested atlas", async () => {
        const stubs = stubSpecimens();

        await Specimen.createOrUpdateForShape({label: "S002", collectionId: "collection-1", atlasId: "atlas-1"}, editor(), allowCreate);

        expect(stubs.create).toHaveBeenCalledWith(expect.objectContaining({atlasId: "atlas-1"}), expect.anything());
    });
});

describe("specimen update", () => {
    test("refuses a different atlas", async () => {
        const stubs = stubSpecimens();

        await expect(Specimen.createOrUpdateForShape({id: "specimen-1", atlasId: "atlas-2"}, editor()))
            .rejects.toThrow(/atlas can not be changed/);

        expect(stubs.stored.update).not.toHaveBeenCalled();
    });

    test("accepts the same atlas without writing it", async () => {
        const stubs = stubSpecimens();

        await Specimen.createOrUpdateForShape({id: "specimen-1", atlasId: "atlas-1", notes: "n"}, editor());

        expect(stubs.stored.update).toHaveBeenCalledTimes(1);
        expect(stubs.stored.update.mock.calls[0][0]).not.toHaveProperty("atlasId");
    });

    test("accepts an update without an atlas", async () => {
        const stubs = stubSpecimens();

        await Specimen.createOrUpdateForShape({id: "specimen-1", notes: "n"}, editor());

        expect(stubs.stored.update).toHaveBeenCalledTimes(1);
    });

    test("an import's label match updates rather than creates", async () => {
        const stubs = stubSpecimens();

        await Specimen.createOrUpdateForShape({label: "S001", collectionId: "collection-1", atlasId: "atlas-1"}, editor(), {allowCreate: true, allowMatchLabel: true});

        expect(stubs.create).not.toHaveBeenCalled();
        expect(stubs.stored.update).toHaveBeenCalledTimes(1);
    });
});

describe("findAtlasId", () => {
    test("reads past the paranoid scope through the given transaction", async () => {
        const findByPk = vi.spyOn(Specimen, "findByPk").mockResolvedValue({id: "specimen-1", atlasId: "atlas-1"});

        expect(await Specimen.findAtlasId("specimen-1", transaction)).toBe("atlas-1");

        expect(findByPk).toHaveBeenCalledWith("specimen-1", expect.objectContaining({paranoid: false, transaction}));
    });

    test("returns null for a specimen with no row", async () => {
        vi.spyOn(Specimen, "findByPk").mockResolvedValue(null);

        expect(await Specimen.findAtlasId("specimen-missing")).toBeNull();
    });
});
