import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {graphql} = require("graphql");
const {createSchema} = require("../src/graphql/schema");
const {User, UserPermissions} = require("../src/models/user");
const {Neuron} = require("../src/models/neuron");
const {Specimen} = require("../src/models/specimen");
const {EventLogItem} = require("../src/models/eventLogItem");
const {createRequestContext} = require("../src/graphql/requestContext");

const transaction = {sentinel: "t"} as any;

const fullMetadata = {instance: 1, priority: 2, somaGroup: "g"};

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

    vi.spyOn(Specimen, "findAtlasId").mockResolvedValue("atlas-1");

    return vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
}

function stubCreate() {
    stubCommon();

    vi.spyOn(Specimen, "findByPk").mockResolvedValue({id: "specimen-1", atlasId: "atlas-1"});
    vi.spyOn(Neuron, "findAll").mockResolvedValue([]);

    return vi.spyOn(Neuron, "create").mockImplementation(async (shape: any) => prototypeStub(Neuron, shape));
}

function stubUpdate(stored: object | null = fullMetadata) {
    const eventCreate = stubCommon();

    const neuron = prototypeStub(Neuron, {id: "neuron-1", label: "N001", specimenId: "specimen-1", metadata: stored});

    vi.spyOn(Neuron, "findByPk").mockResolvedValue(neuron);

    return {neuron, eventCreate};
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Neuron as any).sequelize;
});

function createArgument(create: any): any {
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
}

describe("neuron metadata on create", () => {
    function createWith(metadata: object) {
        return Neuron.createOrUpdateForShape({label: "N002", specimenId: "specimen-1", ...metadata}, editor(), {allowCreate: true});
    }

    test("stores a supplied object as sent", async () => {
        const create = stubCreate();

        await createWith({metadata: {...fullMetadata}});

        expect(createArgument(create).metadata).toStrictEqual(fullMetadata);
    });

    test("stores a partial object as sent", async () => {
        const create = stubCreate();

        await createWith({metadata: {priority: 3}});

        expect(createArgument(create).metadata).toStrictEqual({priority: 3});
    });

    test("stores null when the field is omitted", async () => {
        const create = stubCreate();

        await createWith({});

        expect(createArgument(create)).toHaveProperty("metadata", null);
    });

    test("stores null for an explicit null", async () => {
        const create = stubCreate();

        await createWith({metadata: null});

        expect(createArgument(create)).toHaveProperty("metadata", null);
    });
});

describe("neuron metadata on update", () => {
    function updateArgument(neuron: any) {
        expect(neuron.update).toHaveBeenCalledTimes(1);
        return neuron.update.mock.calls[0][0];
    }

    test("overwrites only the supplied sub-properties", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", metadata: {priority: 5}}, editor());

        expect(updateArgument(stubs.neuron).metadata).toStrictEqual({instance: 1, priority: 5, somaGroup: "g"});
    });

    test("stores a null sub-property rather than removing it", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", metadata: {somaGroup: null}}, editor());

        expect(updateArgument(stubs.neuron).metadata).toStrictEqual({instance: 1, priority: 2, somaGroup: null});
    });

    test("adds a sub-property the stored object lacks", async () => {
        const stubs = stubUpdate({priority: 2});

        await Neuron.createOrUpdateForShape({id: "neuron-1", metadata: {somaGroup: "x"}}, editor());

        expect(updateArgument(stubs.neuron).metadata).toStrictEqual({priority: 2, somaGroup: "x"});
    });

    test("stores the supplied object when the column is null", async () => {
        const stubs = stubUpdate(null);

        await Neuron.createOrUpdateForShape({id: "neuron-1", metadata: {priority: 1}}, editor());

        expect(updateArgument(stubs.neuron).metadata).toStrictEqual({priority: 1});
    });

    test("a null clears the column", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", metadata: null}, editor());

        expect(updateArgument(stubs.neuron)).toHaveProperty("metadata", null);
    });

    test("leaves the column alone when the field is omitted", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", keywords: ["k"]}, editor());

        expect(updateArgument(stubs.neuron)).not.toHaveProperty("metadata");
    });

    test("records the merged object in the event log", async () => {
        const stubs = stubUpdate();

        await Neuron.createOrUpdateForShape({id: "neuron-1", metadata: {priority: 5}}, editor());

        expect((stubs.eventCreate.mock.calls[0][0] as any).details.metadata).toStrictEqual({instance: 1, priority: 5, somaGroup: "g"});
    });
});

describe("neuron metadata through the GraphQL API", () => {
    const schema = createSchema();

    async function execute(source: string, variableValues?: object) {
        const result: any = await graphql({schema, source, variableValues, contextValue: createRequestContext(editor())});

        expect(result.errors).toBeUndefined();

        return result.data;
    }

    test("createNeuron stores and returns the object", async () => {
        stubCreate();

        const data = await execute(`mutation {
            createNeuron(neuron: {label: "N002", specimenId: "specimen-1", metadata: {instance: 1, priority: 2, somaGroup: "g"}}) {
                metadata { instance priority somaGroup }
            }
        }`);

        expect(data.createNeuron.metadata).toEqual(fullMetadata);
    });

    test("updateNeuron merges a partial inline object", async () => {
        stubUpdate();

        const data = await execute(`mutation {
            updateNeuron(neuron: {id: "neuron-1", metadata: {priority: 5}}) { metadata { instance priority somaGroup } }
        }`);

        expect(data.updateNeuron.metadata).toEqual({instance: 1, priority: 5, somaGroup: "g"});
    });

    test("updateNeuron stores an explicit null sub-property from variables", async () => {
        stubUpdate();

        const data = await execute(`mutation($metadata: NeuronMetadataInput) {
            updateNeuron(neuron: {id: "neuron-1", metadata: $metadata}) { metadata { instance priority somaGroup } }
        }`, {metadata: {somaGroup: null}});

        expect(data.updateNeuron.metadata).toEqual({instance: 1, priority: 2, somaGroup: null});
    });

    test("updateNeuron with a null clears the object", async () => {
        stubUpdate();

        const data = await execute(`mutation {
            updateNeuron(neuron: {id: "neuron-1", metadata: null}) { metadata { instance priority somaGroup } }
        }`);

        expect(data.updateNeuron.metadata).toBeNull();
    });
});
