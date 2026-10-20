import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {graphql} = require("graphql");
const {Op} = require("sequelize");
const {createSchema} = require("../src/graphql/schema");
const {openResolvers} = require("../src/graphql/openResolvers");
const {createRequestContext} = require("../src/graphql/requestContext");
const {Neuron} = require("../src/models/neuron");
const {Specimen} = require("../src/models/specimen");
const {AtlasStructure} = require("../src/models/atlasStructure");
const {Reconstruction} = require("../src/models/reconstruction");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {User} = require("../src/models/user");

function userStub() {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    return user;
}

function neuronStub(properties: object) {
    return Object.assign(Object.create(Neuron.prototype), properties);
}

function stubSpecimens() {
    return vi.spyOn(Specimen, "findAll").mockImplementation(async (options: any) => options.where.id[Op.in].map((id: string) => ({id})));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Neuron batch methods", () => {
    test("reconstructionCounts aligns grouped counts with the ids asked, zero when absent", async () => {
        const count = vi.spyOn(Reconstruction, "count").mockResolvedValue([{neuronId: "neuron-2", count: "3"}]);

        expect(await Neuron.reconstructionCounts(["neuron-1", "neuron-2"])).toEqual([0, 3]);

        const options = count.mock.calls[0][0] as any;

        expect(options.where).toEqual({neuronId: {[Op.in]: ["neuron-1", "neuron-2"]}});
        expect(options.group).toEqual(["neuronId"]);
    });

    test("reconstructionsByNeuron groups every revision under its neuron", async () => {
        const rows = [{id: "reconstruction-1", neuronId: "neuron-2"}, {id: "reconstruction-2", neuronId: "neuron-1"}, {id: "reconstruction-3", neuronId: "neuron-2"}];
        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue(rows);

        expect(await Neuron.reconstructionsByNeuron(["neuron-1", "neuron-2", "neuron-3"])).toEqual([[rows[1]], [rows[0], rows[2]], []]);
        expect((findAll.mock.calls[0][0] as any).include).toEqual([{model: AtlasReconstruction}]);
    });

    test("publishedByNeuron returns each neuron's published atlas reconstruction or null", async () => {
        const child = {id: "atlas-1"};
        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([
            {neuronId: "neuron-1", AtlasReconstruction: child},
            {neuronId: "neuron-2", AtlasReconstruction: null}
        ]);

        expect(await Neuron.publishedByNeuron(["neuron-1", "neuron-2", "neuron-3"])).toEqual([child, null, null]);
        expect((findAll.mock.calls[0][0] as any).where.status).toBe(ReconstructionStatus.Published);
    });
});

describe("loader lifetime", () => {
    test("each request context has its own loaders", async () => {
        const findAll = stubSpecimens();

        await createRequestContext(userStub()).loaders.specimen.load("specimen-1");
        await createRequestContext(userStub()).loaders.specimen.load("specimen-1");

        expect(findAll).toHaveBeenCalledTimes(2);
    });

    test("loads in the same tick share one batch entry", async () => {
        const findAll = stubSpecimens();
        const {loaders} = createRequestContext(userStub());

        const [first, second] = await Promise.all([loaders.specimen.load("specimen-1"), loaders.specimen.load("specimen-1")]);

        expect(findAll).toHaveBeenCalledTimes(1);
        expect((findAll.mock.calls[0][0] as any).where.id[Op.in]).toEqual(["specimen-1"]);
        expect(second).toBe(first);
    });

    test("a later load reads current rows rather than the earlier batch", async () => {
        const findAll = vi.spyOn(Specimen, "findAll")
            .mockResolvedValueOnce([{id: "specimen-1", label: "before"}])
            .mockResolvedValueOnce([{id: "specimen-1", label: "after"}]);
        const {loaders} = createRequestContext(userStub());

        expect((await loaders.specimen.load("specimen-1")).label).toBe("before");
        expect((await loaders.specimen.load("specimen-1")).label).toBe("after");
        expect(findAll).toHaveBeenCalledTimes(2);
    });
});

describe("Neuron fields through the schema", () => {
    const schema = createSchema();

    const source = `{ candidateNeurons(input: {}) { items {
        id reconstructionCount untraceable published { id } reconstructions { id } atlasStructure { id } specimen { id }
    } } }`;

    function stubBatches() {
        return {
            reconstructionCounts: vi.spyOn(Neuron, "reconstructionCounts").mockImplementation(async (ids: any) => ids.map(() => 2)),
            reconstructionsByNeuron: vi.spyOn(Neuron, "reconstructionsByNeuron").mockImplementation(async (ids: any) => ids.map(id => [{id: `${id}-reconstruction`}])),
            publishedByNeuron: vi.spyOn(Neuron, "publishedByNeuron").mockImplementation(async (ids: any) => ids.map(() => null)),
            untraceableByNeuron: vi.spyOn(Neuron, "untraceableByNeuron").mockImplementation(async (ids: any) => ids.map(() => false))
        };
    }

    test("each field makes one batched query for the whole page", async () => {
        const items = [
            neuronStub({id: "neuron-1", specimenId: "specimen-1", atlasStructureId: "structure-1"}),
            neuronStub({id: "neuron-2", specimenId: "specimen-1", atlasStructureId: "structure-2"}),
            neuronStub({id: "neuron-3", specimenId: "specimen-2", atlasStructureId: null})
        ];

        vi.spyOn(Neuron, "getCandidateNeurons").mockResolvedValue({totalCount: 3, offset: 0, items});
        const batches = stubBatches();
        const specimens = stubSpecimens();
        const structures = vi.spyOn(AtlasStructure, "findAll").mockImplementation(async (options: any) => options.where.id[Op.in].map((id: string) => ({id})));

        const result: any = await graphql({schema, source, contextValue: createRequestContext(userStub())});

        expect(result.errors).toBeUndefined();

        for (const batch of Object.values(batches)) {
            expect(batch).toHaveBeenCalledTimes(1);
            expect(batch.mock.calls[0][0]).toEqual(["neuron-1", "neuron-2", "neuron-3"]);
        }

        expect(specimens).toHaveBeenCalledTimes(1);
        expect((specimens.mock.calls[0][0] as any).where.id[Op.in]).toEqual(["specimen-1", "specimen-2"]);

        expect(structures).toHaveBeenCalledTimes(1);
        expect((structures.mock.calls[0][0] as any).where.id[Op.in]).toEqual(["structure-1", "structure-2"]);

        const neurons = result.data.candidateNeurons.items;

        expect(neurons[2].atlasStructure).toBeNull();
        expect(neurons.map((neuron: any) => neuron.specimen.id)).toEqual(["specimen-1", "specimen-1", "specimen-2"]);
        expect(neurons[0].reconstructions).toEqual([{id: "neuron-1-reconstruction"}]);
    });

    test("an eager-loaded specimen is reused", async () => {
        const items = [
            neuronStub({id: "neuron-1", specimenId: "specimen-1", atlasStructureId: null, Specimen: {id: "specimen-1"}}),
            neuronStub({id: "neuron-2", specimenId: "specimen-2", atlasStructureId: null, Specimen: {id: "specimen-2"}})
        ];

        vi.spyOn(Neuron, "getCandidateNeurons").mockResolvedValue({totalCount: 2, offset: 0, items});
        stubBatches();
        const specimens = stubSpecimens();

        const result: any = await graphql({schema, source, contextValue: createRequestContext(userStub())});

        expect(result.errors).toBeUndefined();
        expect(specimens).not.toHaveBeenCalled();
        expect(result.data.candidateNeurons.items.map((neuron: any) => neuron.specimen.id)).toEqual(["specimen-1", "specimen-2"]);
    });

    test("serial mutation fields each read the rows as the previous field left them", async () => {
        const state = {status: ReconstructionStatus.InProgress};
        const neuron = neuronStub({id: "neuron-1"});
        const reconstruction = {id: "reconstruction-1", getNeuron: async () => neuron};

        vi.spyOn(Reconstruction, "pauseReconstruction").mockImplementation(async () => {
            state.status = ReconstructionStatus.OnHold;
            return reconstruction;
        });
        vi.spyOn(Reconstruction, "resumeReconstruction").mockImplementation(async () => {
            state.status = ReconstructionStatus.InProgress;
            return reconstruction;
        });
        const reconstructionsByNeuron = vi.spyOn(Neuron, "reconstructionsByNeuron").mockImplementation(async (ids: any) => ids.map(() => [{id: "reconstruction-1", status: state.status}]));

        const result: any = await graphql({
            schema,
            source: `mutation {
                paused: pauseReconstruction(reconstructionId: "reconstruction-1") { neuron { reconstructions { status } } }
                resumed: resumeReconstruction(reconstructionId: "reconstruction-1") { neuron { reconstructions { status } } }
            }`,
            contextValue: createRequestContext(userStub())
        });

        expect(result.errors).toBeUndefined();
        expect(result.data.paused.neuron.reconstructions[0].status).toBe(ReconstructionStatus.OnHold);
        expect(result.data.resumed.neuron.reconstructions[0].status).toBe(ReconstructionStatus.InProgress);
        expect(reconstructionsByNeuron).toHaveBeenCalledTimes(2);
    });
});

describe("the user query", () => {
    test("returns the context's user", () => {
        const user = userStub();

        expect(openResolvers.Query.user(null, null, {user})).toBe(user);
    });
});
