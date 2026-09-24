import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {GraphQLNonNull, GraphQLObjectType, GraphQLString} = require("graphql");
const {createSchema} = require("../src/graphql/schema");
const {secureResolvers} = require("../src/graphql/secureResolvers");
const {User} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");

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
