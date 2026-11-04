import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {graphql, GraphQLFloat, GraphQLInt, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLString} = require("graphql");
const {createSchema} = require("../src/graphql/schema");
const {secureResolvers} = require("../src/graphql/secureResolvers");
const {openResolvers} = require("../src/graphql/openResolvers");
const {User} = require("../src/models/user");
const {createRequestContext} = require("../src/graphql/requestContext");
const {Annotation} = require("../src/models/annotation");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {Neuron} = require("../src/models/neuron");
const {Atlas} = require("../src/models/atlas");
const {AtlasKind} = require("../src/models/atlasKind");
const {AtlasStructure} = require("../src/models/atlasStructure");

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the hold mutations in the schema", () => {
    const mutation = createSchema().getMutationType();

    test.each(["markAnnotationIncomplete", "markAnnotationDuplicate"])("%s takes an annotation id and returns an Annotation", (name: string) => {
        const field = mutation.getFields()[name];

        expect(field).toBeDefined();
        expect(field.args.map((arg: any) => arg.name)).toEqual(["annotationId"]);

        const argType = field.args[0].type;
        expect(argType).toBeInstanceOf(GraphQLNonNull);
        expect(argType.ofType).toBe(GraphQLString);

        expect(field.type).toBeInstanceOf(GraphQLObjectType);
        expect(field.type.name).toBe("Annotation");
    });

    test.each(["pauseAnnotation", "resumeAnnotation"])("%s is still present", (name: string) => {
        expect(mutation.getFields()[name]).toBeDefined();
    });
});

describe("the hold mutation resolvers", () => {
    test.each([
        ["markAnnotationIncomplete", "markIncomplete"],
        ["markAnnotationDuplicate", "markDuplicate"]
    ])("%s delegates to Annotation.%s", async (resolver: string, method: string) => {
        const user = Object.create(User.prototype);
        const result = {id: "annotation-1"};
        const spy = vi.spyOn(Annotation, method).mockResolvedValue(result);

        const output = await secureResolvers.Mutation[resolver](null, {annotationId: "annotation-1"}, {user});

        expect(spy).toHaveBeenCalledWith("annotation-1", user);
        expect(output).toBe(result);
    });
});

describe("atlas discovery in the schema", () => {
    const schema = createSchema();
    const query = schema.getQueryType();

    test.each([
        ["atlases", "Atlas"],
        ["atlasKinds", "AtlasKind"]
    ])("%s returns a non-null list of non-null %s", (name: string, typeName: string) => {
        const type = query.getFields()[name].type;

        expect(type).toBeInstanceOf(GraphQLNonNull);
        expect(type.ofType).toBeInstanceOf(GraphQLList);
        expect(type.ofType.ofType).toBeInstanceOf(GraphQLNonNull);
        expect(type.ofType.ofType.ofType.name).toBe(typeName);
    });

    test("atlasStructures requires an atlasId", () => {
        const atlasId = query.getFields()["atlasStructures"].args.find((arg: any) => arg.name === "atlasId");

        expect(atlasId.type).toBeInstanceOf(GraphQLNonNull);
        expect(atlasId.type.ofType).toBe(GraphQLString);
    });

    test.each(["AtlasStructure", "Specimen"])("%s exposes its atlasId", (typeName: string) => {
        expect(schema.getType(typeName).getFields().atlasId).toBeDefined();
    });

    test("Atlas links to its kind and its structures", () => {
        const fields = schema.getType("Atlas").getFields();

        expect(fields.atlasKind.type.name).toBe("AtlasKind");

        expect(fields.atlasStructures.type).toBeInstanceOf(GraphQLNonNull);
        expect(fields.atlasStructures.type.ofType).toBeInstanceOf(GraphQLList);
        expect(fields.atlasStructures.type.ofType.ofType.ofType.name).toBe("AtlasStructure");
    });

    test("AtlasKind links to its atlases", () => {
        const atlases = schema.getType("AtlasKind").getFields().atlases;

        expect(atlases.type).toBeInstanceOf(GraphQLNonNull);
        expect(atlases.type.ofType).toBeInstanceOf(GraphQLList);
        expect(atlases.type.ofType.ofType.ofType.name).toBe("Atlas");
    });

    test("Atlas does not expose its spatialUrl", () => {
        expect(schema.getType("Atlas").getFields().spatialUrl).toBeUndefined();
    });

    test("createSpecimen takes SpecimenCreateInput, which requires an atlasId", () => {
        const argType = schema.getMutationType().getFields()["createSpecimen"].args[0].type;

        expect(argType.name).toBe("SpecimenCreateInput");

        const atlasId = argType.getFields().atlasId;

        expect(atlasId.type).toBeInstanceOf(GraphQLNonNull);
        expect(atlasId.type.ofType).toBe(GraphQLString);
    });

    test("SpecimenInput, used by updateSpecimen, has no atlasId", () => {
        expect(schema.getMutationType().getFields()["updateSpecimen"].args[0].type.name).toBe("SpecimenInput");
        expect(schema.getType("SpecimenInput").getFields().atlasId).toBeUndefined();
    });

    test("SearchContext accepts atlasKindIds", () => {
        expect(schema.getType("SearchContext").getFields().atlasKindIds).toBeDefined();
    });
});

describe("atlas discovery resolvers", () => {
    test("atlases delegates to Atlas.getAll", () => {
        const result = [{id: "atlas-1"}];
        const spy = vi.spyOn(Atlas, "getAll").mockReturnValue(result);

        expect(openResolvers.Query.atlases()).toBe(result);
        expect(spy).toHaveBeenCalled();
    });

    test("atlasKinds delegates to AtlasKind.getAll", async () => {
        const result = [{id: "kind-1"}];
        const spy = vi.spyOn(AtlasKind, "getAll").mockResolvedValue(result);

        expect(await openResolvers.Query.atlasKinds()).toBe(result);
        expect(spy).toHaveBeenCalled();
    });

    test("atlasStructures delegates to AtlasStructure.getForAtlas", async () => {
        const result = [{id: "structure-1"}];
        const spy = vi.spyOn(AtlasStructure, "getForAtlas").mockResolvedValue(result);

        expect(await openResolvers.Query.atlasStructures(null, {atlasId: "atlas-1"})).toBe(result);
        expect(spy).toHaveBeenCalledWith("atlas-1");
    });

    test("an atlas kind's atlases are those of that kind", () => {
        const result = [{id: "atlas-1"}];
        const spy = vi.spyOn(Atlas, "getForKind").mockReturnValue(result);

        expect(openResolvers.AtlasKind.atlases({id: "kind-1"})).toBe(result);
        expect(spy).toHaveBeenCalledWith("kind-1");
    });

    test("an atlas's kind comes from its association", async () => {
        const kind = {id: "kind-1"};
        const atlas = {getAtlasKind: vi.fn().mockResolvedValue(kind)};

        expect(await openResolvers.Atlas.atlasKind(atlas)).toBe(kind);
    });

    test("an atlas's structures are that atlas's alone", async () => {
        const result = [{id: "structure-1"}];
        const spy = vi.spyOn(AtlasStructure, "getForAtlas").mockResolvedValue(result);

        expect(await openResolvers.Atlas.atlasStructures({id: "atlas-1"})).toBe(result);
        expect(spy).toHaveBeenCalledWith("atlas-1");
    });
});

describe("portal export types in the schema", () => {
    const schema = createSchema();

    test("PortalNeuron exposes a nullable canonicalDoi", () => {
        expect(schema.getType("PortalNeuron").getFields().canonicalDoi.type).toBe(GraphQLString);
    });

    test("PortalReconstruction exposes a nullable doi", () => {
        expect(schema.getType("PortalReconstruction").getFields().doi.type).toBe(GraphQLString);
    });

    test("PortalReconstruction exposes a nullable publishedAt Date", () => {
        const type = schema.getType("PortalReconstruction").getFields().publishedAt.type;

        expect(type).not.toBeInstanceOf(GraphQLNonNull);
        expect(type.name).toBe("Date");
    });
});

describe("portal export serialization", () => {
    const schema = createSchema();
    const exporterUser = Object.create(User.prototype);
    const parentDate = new Date("2026-03-01T12:00:00Z");

    function portalReconstruction(overrides: object) {
        return {
            id: "annotation-1",
            annotationSpace: 0,
            neuron: {id: "neuron-1", label: "N1", canonicalDoi: "10.48813/abcd-1234", specimen: null},
            annotator: null,
            peerReviewer: null,
            teamReviewer: null,
            proofreader: null,
            nodes: [],
            ...overrides
        };
    }

    // Guards against the producer handing the Date scalar a number, which it serializes as 0.
    test("exportedSpecimenReconstruction serializes publishedAt as epoch milliseconds", async () => {
        vi.spyOn(SpecimenSpaceReconstruction, "toPortalFormat").mockResolvedValue(portalReconstruction({doi: null, publishedAt: parentDate}));

        const result: any = await graphql({
            schema,
            source: "{ exportedSpecimenReconstruction(id: \"specimen-space-1\") { doi publishedAt neuron { canonicalDoi } } }",
            contextValue: createRequestContext(exporterUser)
        });

        expect(result.errors).toBeUndefined();

        const exported = result.data.exportedSpecimenReconstruction;

        expect(exported.publishedAt).toBe(parentDate.getTime());
        expect(exported.doi).toBeNull();
        expect(exported.neuron.canonicalDoi).toBe("10.48813/abcd-1234");
    });

    test("exportedAtlasReconstruction serializes the atlas doi and a null publishedAt", async () => {
        vi.spyOn(AtlasReconstruction, "toPortalFormat").mockResolvedValue(portalReconstruction({doi: "10.0000/atlas-1", publishedAt: null}));

        const result: any = await graphql({
            schema,
            source: "{ exportedAtlasReconstruction(id: \"atlas-1\") { doi publishedAt } }",
            contextValue: createRequestContext(exporterUser)
        });

        expect(result.errors).toBeUndefined();
        expect(result.data.exportedAtlasReconstruction.doi).toBe("10.0000/atlas-1");
        expect(result.data.exportedAtlasReconstruction.publishedAt).toBeNull();
    });
});

describe("neuron metadata in the schema", () => {
    const schema = createSchema();

    function expectNullableFields(typeName: string, expected: object) {
        const fields = schema.getType(typeName).getFields();

        for (const [name, scalar] of Object.entries(expected)) {
            expect(fields[name].type).toBe(scalar);
        }
    }

    test("Neuron exposes a nullable NeuronMetadata", () => {
        const type = schema.getType("Neuron").getFields().metadata.type;

        expect(type).not.toBeInstanceOf(GraphQLNonNull);
        expect(type.name).toBe("NeuronMetadata");

        expectNullableFields("NeuronMetadata", {instance: GraphQLInt, priority: GraphQLInt, somaGroup: GraphQLString});
    });

    test("NeuronInput takes a nullable NeuronMetadataInput", () => {
        const type = schema.getType("NeuronInput").getFields().metadata.type;

        expect(type).not.toBeInstanceOf(GraphQLNonNull);
        expect(type.name).toBe("NeuronMetadataInput");

        expectNullableFields("NeuronMetadataInput", {instance: GraphQLInt, priority: GraphQLInt, somaGroup: GraphQLString});
    });
});

describe("candidate locations in the schema", () => {
    const schema = createSchema();

    test("candidateNeuronLocations takes the candidate filters and a cursor, and returns a non-null chunk", () => {
        const field = schema.getQueryType().getFields()["candidateNeuronLocations"];

        expect(field.args.map((arg: any) => arg.name)).toEqual(["input", "includeInProgress", "excludedAnnotationStatuses", "after", "chunkSize"]);

        expect(field.type).toBeInstanceOf(GraphQLNonNull);
        expect(field.type.ofType.name).toBe("CandidateNeuronLocations");
    });

    test("candidateNeuronOffset takes a required id and the candidate filters, and returns a nullable Int", () => {
        const field = schema.getQueryType().getFields()["candidateNeuronOffset"];

        expect(field.args.map((arg: any) => arg.name)).toEqual(["id", "input", "includeInProgress", "excludedAnnotationStatuses"]);

        const id = field.args.find((arg: any) => arg.name === "id");

        expect(id.type).toBeInstanceOf(GraphQLNonNull);
        expect(id.type.ofType).toBe(GraphQLString);

        expect(field.type).toBe(GraphQLInt);
    });

    test("CandidateNeuronLocations aligns non-null ids with nullable triples of non-null floats", () => {
        const fields = schema.getType("CandidateNeuronLocations").getFields();

        expect(fields.ids.type).toBeInstanceOf(GraphQLNonNull);
        expect(fields.ids.type.ofType).toBeInstanceOf(GraphQLList);
        expect(fields.ids.type.ofType.ofType).toBeInstanceOf(GraphQLNonNull);
        expect(fields.ids.type.ofType.ofType.ofType).toBe(GraphQLString);

        const location = fields.locations.type.ofType.ofType;

        expect(fields.locations.type).toBeInstanceOf(GraphQLNonNull);
        expect(fields.locations.type.ofType).toBeInstanceOf(GraphQLList);
        expect(location).toBeInstanceOf(GraphQLList);
        expect(location.ofType).toBeInstanceOf(GraphQLNonNull);
        expect(location.ofType.ofType).toBe(GraphQLFloat);

        expect(fields.nextCursor.type).toBe(GraphQLString);
        expect(fields.totalCount.type).toBe(GraphQLInt);
    });
});

describe("the annotation split in the schema", () => {
    const schema = createSchema();

    function fieldNames(typeName: string): string[] {
        return Object.keys(schema.getType(typeName).getFields());
    }

    test("no Reconstruction type remains", () => {
        expect(schema.getType("Reconstruction")).toBeUndefined();
    });

    test("no query or mutation takes a reconstructionId or reconstructionIds argument", () => {
        for (const root of [schema.getQueryType(), schema.getMutationType()]) {
            for (const field of Object.values(root.getFields()) as any[]) {
                const argumentNames = field.args.map((arg: any) => arg.name);

                expect(argumentNames, field.name).not.toContain("reconstructionId");
                expect(argumentNames, field.name).not.toContain("reconstructionIds");
            }
        }
    });

    test("the specimen-space data fields moved off Annotation", () => {
        const annotationFields = fieldNames("Annotation");

        for (const name of ["sourceUrl", "sourceComments", "specimenLengthMillimeters", "specimenNodeCounts", "soma", "precomputed"]) {
            expect(annotationFields).not.toContain(name);
        }

        const field = schema.getType("Annotation").getFields().specimenSpaceReconstruction;

        expect(field.type).toBeInstanceOf(GraphQLNonNull);
        expect(field.type.ofType.name).toBe("SpecimenSpaceReconstruction");
    });

    test("SpecimenSpaceReconstruction carries the data fields", () => {
        expect(fieldNames("SpecimenSpaceReconstruction")).toEqual(expect.arrayContaining([
            "sourceUrl", "sourceComments", "lengthMillimeters", "nodeCounts", "soma", "precomputed", "status", "annotationId"
        ]));
    });

    test("the renamed arguments and fields", () => {
        const regeneration = schema.getMutationType().getFields().requestSpecimenSpaceRegeneration;

        expect(regeneration.args.map((arg: any) => arg.name)).toEqual(["specimenSpaceReconstructionId"]);
        expect(regeneration.args[0].type).toBeInstanceOf(GraphQLNonNull);
        expect(regeneration.args[0].type.ofType).toBe(GraphQLString);

        const uploadId = schema.getType("ReconstructionUploadArgs").getFields().annotationId;

        expect(uploadId.type).toBeInstanceOf(GraphQLNonNull);
        expect(uploadId.type.ofType).toBe(GraphQLString);

        const branchId = schema.getType("VersionHistoryBranch").getFields().annotationId;

        expect(branchId.type).toBeInstanceOf(GraphQLNonNull);
        expect(branchId.type.ofType).toBe(GraphQLString);

        expect(fieldNames("AtlasReconstruction")).toEqual(expect.arrayContaining(["annotation", "annotationId"]));
        expect(fieldNames("Neuron")).toEqual(expect.arrayContaining(["annotations", "annotationCount"]));
    });
});

describe("the annotation split in the resolvers", () => {
    test("openAnnotation delegates to Neuron.startAnnotation", async () => {
        const user = Object.create(User.prototype);
        const result = {id: "annotation-1"};
        const spy = vi.spyOn(Neuron, "startAnnotation").mockResolvedValue(result);

        const output = await secureResolvers.Mutation.openAnnotation(null, {neuronId: "neuron-1"}, {user});

        expect(spy).toHaveBeenCalledWith(user, "neuron-1");
        expect(output).toBe(result);
    });

    test("requestSpecimenSpaceRegeneration passes the specimen-space id", async () => {
        const user = Object.create(User.prototype);
        const spy = vi.spyOn(SpecimenSpacePrecomputed, "requestRegenerationForReconstruction").mockResolvedValue({id: "precomputed-1"});

        await secureResolvers.Mutation.requestSpecimenSpaceRegeneration(null, {specimenSpaceReconstructionId: "specimen-space-1"}, {user});

        expect(spy).toHaveBeenCalledWith(user, "specimen-space-1");
    });

    test("specimenSpaceReconstruction returns the eager-loaded row without the getter", async () => {
        const row = {id: "specimen-space-1"};
        const annotation = {id: "annotation-1", SpecimenSpaceReconstruction: row, getSpecimenSpaceReconstruction: vi.fn()};

        expect(await secureResolvers.Annotation.specimenSpaceReconstruction(annotation)).toBe(row);
        expect(annotation.getSpecimenSpaceReconstruction).not.toHaveBeenCalled();
    });

    test("specimenSpaceReconstruction reads past paranoid when nothing was eager-loaded", async () => {
        const row = {id: "specimen-space-1"};
        const annotation = {id: "annotation-1", getSpecimenSpaceReconstruction: vi.fn().mockResolvedValue(row)};

        expect(await secureResolvers.Annotation.specimenSpaceReconstruction(annotation)).toBe(row);
        expect(annotation.getSpecimenSpaceReconstruction).toHaveBeenCalledWith({paranoid: false});
    });
});

describe("the DOI on Annotation in the schema", () => {
    const schema = createSchema();

    test("Annotation exposes a nullable doi", () => {
        expect(schema.getType("Annotation").getFields().doi.type).toBe(GraphQLString);
    });

    test("AtlasReconstruction has no doi", () => {
        expect(Object.keys(schema.getType("AtlasReconstruction").getFields())).not.toContain("doi");
    });

    test("Neuron.published is an Annotation", () => {
        expect(schema.getType("Neuron").getFields().published.type.name).toBe("Annotation");
    });

    test("AtlasReconstruction.annotation returns the eager-loaded annotation without the getter", async () => {
        const annotation = {id: "annotation-1"};
        const reconstruction = {id: "atlas-1", Annotation: annotation, getAnnotation: vi.fn()};

        expect(await openResolvers.AtlasReconstruction.annotation(reconstruction)).toBe(annotation);
        expect(reconstruction.getAnnotation).not.toHaveBeenCalled();
    });

    test("AtlasReconstruction.annotation falls back to the getter", async () => {
        const annotation = {id: "annotation-1"};
        const reconstruction = {id: "atlas-1", getAnnotation: vi.fn().mockResolvedValue(annotation)};

        expect(await openResolvers.AtlasReconstruction.annotation(reconstruction)).toBe(annotation);
        expect(reconstruction.getAnnotation).toHaveBeenCalledTimes(1);
    });
});
