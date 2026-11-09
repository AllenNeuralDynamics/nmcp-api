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
const {RawReconstruction} = require("../src/models/rawReconstruction");
const {RawReconstructionUpload} = require("../src/models/rawReconstructionUpload");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {Neuron} = require("../src/models/neuron");
const {Atlas} = require("../src/models/atlas");
const {AtlasKind} = require("../src/models/atlasKind");
const {AtlasStructure} = require("../src/models/atlasStructure");
const {AtlasQualityControl} = require("../src/models/atlasQualityControl");

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

describe("raw reconstructions in the schema", () => {
    const schema = createSchema();
    const mutation = schema.getMutationType();

    test.each(["uploadRawSwcData", "uploadRawParquetData"])("%s takes RawReconstructionUploadArgs and returns RawReconstructionUpload", (name: string) => {
        const field = mutation.getFields()[name];

        expect(field).toBeDefined();
        expect(field.args.map((arg: any) => arg.name)).toEqual(["uploadArgs"]);
        expect(field.args[0].type).toBeInstanceOf(GraphQLNonNull);
        expect(field.args[0].type.ofType.name).toBe("RawReconstructionUploadArgs");
        expect(field.type.name).toBe("RawReconstructionUpload");
    });

    test("RawReconstructionUploadArgs takes a required annotation id and file, and optional notes", () => {
        const fields = schema.getType("RawReconstructionUploadArgs").getFields();

        expect(Object.keys(fields).sort()).toEqual(["annotationId", "file", "notes"]);
        expect(fields.annotationId.type).toBeInstanceOf(GraphQLNonNull);
        expect(fields.annotationId.type.ofType).toBe(GraphQLString);
        expect(fields.notes.type).toBe(GraphQLString);
        expect(fields.file.type).toBeInstanceOf(GraphQLNonNull);
        expect(fields.file.type.ofType.name).toBe("Upload");
    });

    test("Annotation exposes a nullable rawReconstruction and latestRawReconstructionUpload", () => {
        const fields = schema.getType("Annotation").getFields();

        expect(fields.rawReconstruction.type.name).toBe("RawReconstruction");
        expect(fields.latestRawReconstructionUpload.type.name).toBe("RawReconstructionUpload");
    });

    test("RawReconstruction exposes no node data", () => {
        const fields = schema.getType("RawReconstruction").getFields();

        expect(fields.nodes).toBeUndefined();
        expect(fields.soma).toBeUndefined();
        expect(fields.nodeCounts).toBeDefined();
    });

    test("RawReconstructionUpload exposes its attempt number and uploader", () => {
        const fields = schema.getType("RawReconstructionUpload").getFields();

        expect(fields.attemptNumber.type).toBe(GraphQLInt);
        expect(fields.user.type.name).toBe("User");
    });

    test("exportedRawReconstruction takes a required id and returns a PortalReconstruction", () => {
        const field = schema.getQueryType().getFields().exportedRawReconstruction;

        expect(field.args.map((arg: any) => arg.name)).toEqual(["id"]);
        expect(field.args[0].type).toBeInstanceOf(GraphQLNonNull);
        expect(field.type.name).toBe("PortalReconstruction");
    });
});

describe("raw reconstruction resolvers", () => {
    test("exportedRawReconstruction serializes publishedAt as epoch milliseconds", async () => {
        const publishedAt = new Date("2026-03-01T12:00:00Z");

        vi.spyOn(RawReconstruction, "toPortalFormat").mockResolvedValue({
            id: "raw-1",
            annotationSpace: 0,
            doi: null,
            publishedAt,
            neuron: {id: "neuron-1", label: "N1", canonicalDoi: null, specimen: null},
            annotator: null,
            peerReviewer: null,
            teamReviewer: null,
            proofreader: null,
            nodes: []
        });

        const result: any = await graphql({
            schema: createSchema(),
            source: "{ exportedRawReconstruction(id: \"raw-1\") { id publishedAt } }",
            contextValue: createRequestContext(Object.create(User.prototype))
        });

        expect(result.errors).toBeUndefined();
        expect(result.data.exportedRawReconstruction.id).toBe("raw-1");
        expect(result.data.exportedRawReconstruction.publishedAt).toBe(publishedAt.getTime());
    });

    test("Annotation.rawReconstruction prefers an eager-loaded row", async () => {
        const raw = {id: "raw-1"};
        const annotation = {RawReconstruction: raw, getRawReconstruction: vi.fn()};

        expect(await secureResolvers.Annotation.rawReconstruction(annotation)).toBe(raw);
        expect(annotation.getRawReconstruction).not.toHaveBeenCalled();
    });

    test("Annotation.rawReconstruction fetches when nothing was eager-loaded", async () => {
        const raw = {id: "raw-1"};
        const annotation = {getRawReconstruction: vi.fn().mockResolvedValue(raw)};

        expect(await secureResolvers.Annotation.rawReconstruction(annotation)).toBe(raw);
    });

    test("Annotation.latestRawReconstructionUpload delegates to findLatestForAnnotation", async () => {
        const latest = {id: "attempt-2"};
        const spy = vi.spyOn(RawReconstructionUpload, "findLatestForAnnotation").mockResolvedValue(latest);

        expect(await secureResolvers.Annotation.latestRawReconstructionUpload({id: "annotation-1"})).toBe(latest);
        expect(spy).toHaveBeenCalledWith("annotation-1");
    });

    test.each([
        ["uploadRawSwcData", "fromSwcUpload"],
        ["uploadRawParquetData", "fromParquetUpload"]
    ])("%s delegates to RawReconstructionUpload.%s", async (resolver: string, method: string) => {
        const user = Object.create(User.prototype);
        const uploadArgs = {annotationId: "annotation-1", file: Promise.resolve({})};
        const attempt = {id: "attempt-1"};
        const spy = vi.spyOn(RawReconstructionUpload, method).mockResolvedValue(attempt);

        expect(await secureResolvers.Mutation[resolver](null, {uploadArgs}, {user})).toBe(attempt);
        expect(spy).toHaveBeenCalledWith(user, uploadArgs);
    });
});

describe("atlas quality control in the schema", () => {
    const schema = createSchema();

    const storedV03 = {
        serviceVersion: 3,
        toolVersion: "1.0.3",
        when: "2026-11-09T12:00:00.000Z",
        qcServiceVersion: "3.0.3",
        score: 500,
        error: null,
        qualityControl: {metrics: [{name: "non_empty", status_history: [{status: "Pass"}]}]}
    };

    const storedV02 = {
        serviceVersion: 2,
        toolVersion: "0.0.1",
        when: "2026-01-01T00:00:00.000Z",
        score: 400,
        passed: [],
        warnings: [],
        errors: [{name: "Soma Count", safeName: "SomaCount", description: "d", nodes: [1]}],
        toolError: null
    };

    test("the atlasQualityControl query replaces qualityControl", () => {
        const fields = schema.getQueryType().getFields();

        expect(fields.atlasQualityControl.type.name).toBe("AtlasQualityControl");
        expect(fields.qualityControl).toBeUndefined();
    });

    test("the retired types are gone and the atlas field returns the renamed type", () => {
        expect(schema.getType("QualityControl")).toBeUndefined();
        expect(schema.getType("QualityControlTest")).toBeUndefined();
        expect(schema.getType("QualityControlToolError")).toBeUndefined();

        expect(schema.getType("AtlasReconstruction").getFields().qualityControl.type.name).toBe("AtlasQualityControl");
    });

    test("QualityOutput has the three common fields and the opaque data field", () => {
        const fields = schema.getType("QualityOutput").getFields();

        expect(Object.keys(fields)).toEqual(["serviceVersion", "toolVersion", "when", "data"]);
        expect(fields.serviceVersion.type.toString()).toBe("Int!");
        expect(fields.toolVersion.type.toString()).toBe("String!");
        expect(fields.when.type.toString()).toBe("Date");
        expect(fields.data.type.toString()).toBe("JSON");
    });

    test("stored outputs of every version serialize their common fields and return the whole object as data", async () => {
        vi.spyOn(AtlasQualityControl, "findByPk").mockResolvedValue({id: "qc-1", status: 500, current: storedV03, history: [storedV02]});

        const result: any = await graphql({
            schema,
            source: "{ atlasQualityControl(id: \"qc-1\") { current { serviceVersion toolVersion when data } history { serviceVersion data } } }",
            contextValue: createRequestContext(Object.create(User.prototype))
        });

        expect(result.errors).toBeUndefined();

        const {current, history} = result.data.atlasQualityControl;

        expect(current.serviceVersion).toBe(3);
        expect(current.toolVersion).toBe("1.0.3");
        expect(current.when).toBe(Date.parse(storedV03.when));
        expect(current.data).toEqual(storedV03);
        expect(history[0].serviceVersion).toBe(2);
        expect(history[0].data.errors).toEqual(storedV02.errors);
    });

    test("the typed fields can be read without data", async () => {
        vi.spyOn(AtlasQualityControl, "findByPk").mockResolvedValue({id: "qc-1", status: 500, current: storedV03, history: null});

        const result: any = await graphql({
            schema,
            source: "{ atlasQualityControl(id: \"qc-1\") { current { serviceVersion toolVersion when } } }",
            contextValue: createRequestContext(Object.create(User.prototype))
        });

        expect(result.errors).toBeUndefined();
        expect(result.data.atlasQualityControl.current).toEqual({serviceVersion: 3, toolVersion: "1.0.3", when: Date.parse(storedV03.when)});
    });

    test("AtlasReconstruction.qualityControl resolves through the renamed association", async () => {
        const row = {id: "qc-1"};
        const reconstruction = {getAtlasQualityControl: vi.fn().mockResolvedValue(row)};

        expect(await secureResolvers.AtlasReconstruction.qualityControl(reconstruction)).toBe(row);
    });
});
