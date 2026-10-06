import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLString} = require("graphql");
const {createSchema} = require("../src/graphql/schema");
const {secureResolvers} = require("../src/graphql/secureResolvers");
const {openResolvers} = require("../src/graphql/openResolvers");
const {User} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {Atlas} = require("../src/models/atlas");
const {AtlasKind} = require("../src/models/atlasKind");
const {AtlasStructure} = require("../src/models/atlasStructure");

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the hold mutations in the schema", () => {
    const mutation = createSchema().getMutationType();

    test.each(["markReconstructionIncomplete", "markReconstructionDuplicate"])("%s takes a reconstruction id and returns a Reconstruction", (name: string) => {
        const field = mutation.getFields()[name];

        expect(field).toBeDefined();
        expect(field.args.map((arg: any) => arg.name)).toEqual(["reconstructionId"]);

        const argType = field.args[0].type;
        expect(argType).toBeInstanceOf(GraphQLNonNull);
        expect(argType.ofType).toBe(GraphQLString);

        expect(field.type).toBeInstanceOf(GraphQLObjectType);
        expect(field.type.name).toBe("Reconstruction");
    });

    test.each(["pauseReconstruction", "resumeReconstruction"])("%s is still present", (name: string) => {
        expect(mutation.getFields()[name]).toBeDefined();
    });
});

describe("the hold mutation resolvers", () => {
    test.each([
        ["markReconstructionIncomplete", "markIncomplete"],
        ["markReconstructionDuplicate", "markDuplicate"]
    ])("%s delegates to Reconstruction.%s", async (resolver: string, method: string) => {
        const user = Object.create(User.prototype);
        const result = {id: "reconstruction-1"};
        const spy = vi.spyOn(Reconstruction, method).mockResolvedValue(result);

        const output = await secureResolvers.Mutation[resolver](null, {reconstructionId: "reconstruction-1"}, user);

        expect(spy).toHaveBeenCalledWith("reconstruction-1", user);
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
