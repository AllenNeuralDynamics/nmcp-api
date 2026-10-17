import {expect, test, vi, describe, afterEach} from "vitest";
import {Readable} from "stream";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Specimen} = require("../src/models/specimen");
const {Neuron} = require("../src/models/neuron");
const {EventLogItem} = require("../src/models/eventLogItem");
const somaPropertyParser = require("../src/io/somaPropertyParser");

const transaction = {sentinel: "t"} as any;

const specimenId = "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

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

function stubImport(somaProperties: object | null) {
    Object.defineProperty(Specimen, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
    vi.spyOn(somaPropertyParser, "parseSomaPropertySteam").mockResolvedValue([]);
    vi.spyOn(Neuron, "findNextAvailableLabel").mockResolvedValue(1);
    vi.spyOn(Neuron, "insertSomaEntries").mockResolvedValue(0);

    const specimen = prototypeStub(Specimen, {id: specimenId, atlasId: "atlas-1", somaProperties});

    vi.spyOn(Specimen, "findByPk").mockResolvedValue(specimen);

    return specimen;
}

function importWith(defaults: object) {
    return Specimen.importCandidates(editor(), Readable.from([]), {specimenId, shouldLookupSoma: false, ...defaults});
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Specimen as any).sequelize;
});

// The update stub does not reproduce Sequelize's change detection, so these assert what makes Sequelize write: the
// object passed to update is a different object from the stored one.
describe("candidate import soma defaults", () => {
    test("a supplied default reaches update in a new object, leaving the stored one untouched", async () => {
        const stored = {defaultBrightness: 1, defaultVolume: 2};
        const specimen = stubImport(stored);

        await importWith({defaultBrightness: 5});

        const written = specimen.update.mock.calls[0][0].somaProperties;

        expect(written).toStrictEqual({defaultBrightness: 5, defaultVolume: 2});
        expect(written).not.toBe(stored);
        expect(stored).toStrictEqual({defaultBrightness: 1, defaultVolume: 2});
    });

    test("both supplied defaults are overwritten", async () => {
        const specimen = stubImport({defaultBrightness: 1, defaultVolume: 2});

        await importWith({defaultBrightness: 5, defaultVolume: 6});

        expect(specimen.update.mock.calls[0][0].somaProperties).toStrictEqual({defaultBrightness: 5, defaultVolume: 6});
    });

    test("a null column starts from an empty object", async () => {
        const specimen = stubImport(null);

        await importWith({defaultVolume: 3});

        expect(specimen.update.mock.calls[0][0].somaProperties).toStrictEqual({defaultVolume: 3});
    });

    test("null defaults, as the CLI tool sends, write nothing", async () => {
        const specimen = stubImport({defaultBrightness: 1, defaultVolume: 2});

        await importWith({defaultBrightness: null, defaultVolume: null});

        expect(specimen.update).not.toHaveBeenCalled();
    });

    test("zero defaults, as the web client sends for empty fields, write nothing", async () => {
        const stored = {defaultBrightness: 1, defaultVolume: 2};
        const specimen = stubImport(stored);

        await importWith({defaultBrightness: 0, defaultVolume: 0});

        expect(specimen.update).not.toHaveBeenCalled();
        expect(stored).toStrictEqual({defaultBrightness: 1, defaultVolume: 2});
    });
});
