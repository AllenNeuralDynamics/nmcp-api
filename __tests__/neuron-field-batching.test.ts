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
const {Annotation} = require("../src/models/annotation");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {AnnotationStatus} = require("../src/models/annotationStatus");
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
    test("annotationCounts aligns grouped counts with the ids asked, zero when absent", async () => {
        const count = vi.spyOn(Annotation, "count").mockResolvedValue([{neuronId: "neuron-2", count: "3"}]);

        expect(await Neuron.annotationCounts(["neuron-1", "neuron-2"])).toEqual([0, 3]);

        const options = count.mock.calls[0][0] as any;

        expect(options.where).toEqual({neuronId: {[Op.in]: ["neuron-1", "neuron-2"]}});
        expect(options.group).toEqual(["neuronId"]);
    });

    test("annotationsByNeuron groups every revision under its neuron", async () => {
        const rows = [{id: "annotation-1", neuronId: "neuron-2"}, {id: "annotation-2", neuronId: "neuron-1"}, {id: "annotation-3", neuronId: "neuron-2"}];
        const findAll = vi.spyOn(Annotation, "findAll").mockResolvedValue(rows);

        expect(await Neuron.annotationsByNeuron(["neuron-1", "neuron-2", "neuron-3"])).toEqual([[rows[1]], [rows[0], rows[2]], []]);
        expect((findAll.mock.calls[0][0] as any).include).toEqual([{model: AtlasReconstruction}, {model: SpecimenSpaceReconstruction}]);
    });

    test("publishedByNeuron returns each neuron's published annotation or null", async () => {
        const rows = [
            {neuronId: "neuron-1", AtlasReconstruction: {id: "atlas-1"}},
            {neuronId: "neuron-2", AtlasReconstruction: null}
        ];
        const findAll = vi.spyOn(Annotation, "findAll").mockResolvedValue(rows);

        expect(await Neuron.publishedByNeuron(["neuron-1", "neuron-2", "neuron-3"])).toEqual([rows[0], rows[1], null]);
        expect((findAll.mock.calls[0][0] as any).where.status).toBe(AnnotationStatus.Published);
        expect((findAll.mock.calls[0][0] as any).include).toEqual([{model: AtlasReconstruction}, {model: SpecimenSpaceReconstruction}]);
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
        id annotationCount untraceable published { id } annotations { id } atlasStructure { id } specimen { id }
    } } }`;

    function stubBatches() {
        return {
            annotationCounts: vi.spyOn(Neuron, "annotationCounts").mockImplementation(async (ids: any) => ids.map(() => 2)),
            annotationsByNeuron: vi.spyOn(Neuron, "annotationsByNeuron").mockImplementation(async (ids: any) => ids.map(id => [{id: `${id}-annotation`}])),
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
        expect(neurons[0].annotations).toEqual([{id: "neuron-1-annotation"}]);
    });

    test("published resolves the annotation's DOI and its eager-loaded children", async () => {
        const published = {
            id: "annotation-1",
            doi: "10.x/1",
            AtlasReconstruction: {id: "atlas-1"},
            SpecimenSpaceReconstruction: {id: "specimen-space-1"},
            getAtlasReconstruction: vi.fn(),
            getSpecimenSpaceReconstruction: vi.fn()
        };

        vi.spyOn(Neuron, "getCandidateNeurons").mockResolvedValue({totalCount: 1, offset: 0, items: [neuronStub({id: "neuron-1"})]});
        vi.spyOn(Neuron, "publishedByNeuron").mockImplementation(async (ids: any) => ids.map(() => published));

        const result: any = await graphql({
            schema,
            source: "{ candidateNeurons(input: {}) { items { published { id doi atlasReconstruction { id } specimenSpaceReconstruction { id } } } } }",
            contextValue: createRequestContext(userStub())
        });

        expect(result.errors).toBeUndefined();
        expect(result.data.candidateNeurons.items[0].published).toEqual({
            id: "annotation-1",
            doi: "10.x/1",
            atlasReconstruction: {id: "atlas-1"},
            specimenSpaceReconstruction: {id: "specimen-space-1"}
        });
        expect(published.getAtlasReconstruction).not.toHaveBeenCalled();
        expect(published.getSpecimenSpaceReconstruction).not.toHaveBeenCalled();
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
        const state = {status: AnnotationStatus.InProgress};
        const neuron = neuronStub({id: "neuron-1"});
        const annotation = {id: "annotation-1", getNeuron: async () => neuron};

        vi.spyOn(Annotation, "pauseAnnotation").mockImplementation(async () => {
            state.status = AnnotationStatus.OnHold;
            return annotation;
        });
        vi.spyOn(Annotation, "resumeAnnotation").mockImplementation(async () => {
            state.status = AnnotationStatus.InProgress;
            return annotation;
        });
        const annotationsByNeuron = vi.spyOn(Neuron, "annotationsByNeuron").mockImplementation(async (ids: any) => ids.map(() => [{id: "annotation-1", status: state.status}]));

        const result: any = await graphql({
            schema,
            source: `mutation {
                paused: pauseAnnotation(annotationId: "annotation-1") { neuron { annotations { status } } }
                resumed: resumeAnnotation(annotationId: "annotation-1") { neuron { annotations { status } } }
            }`,
            contextValue: createRequestContext(userStub())
        });

        expect(result.errors).toBeUndefined();
        expect(result.data.paused.neuron.annotations[0].status).toBe(AnnotationStatus.OnHold);
        expect(result.data.resumed.neuron.annotations[0].status).toBe(AnnotationStatus.InProgress);
        expect(annotationsByNeuron).toHaveBeenCalledTimes(2);
    });
});

describe("the user query", () => {
    test("returns the context's user", () => {
        const user = userStub();

        expect(openResolvers.Query.user(null, null, {user})).toBe(user);
    });
});
