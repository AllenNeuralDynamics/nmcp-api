import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the models call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");
const {Genotype} = require("../src/models/genotype");
const {Injection} = require("../src/models/injection");
const {Specimen} = require("../src/models/specimen");
const {Neuron} = require("../src/models/neuron");

function userWithPermissions(permissions: number) {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    user.permissions = permissions;
    return user;
}

// Each entry pairs an entry point with the Sequelize static it must not reach when the guard denies.
const entryPoints = [
    {name: "Genotype.getById", model: Genotype, query: "findByPk", invoke: (user: any) => Genotype.getById(user, "id-1")},
    {name: "Injection.getById", model: Injection, query: "findByPk", invoke: (user: any) => Injection.getById(user, "id-1")},
    {name: "Injection.getAll", model: Injection, query: "findAll", invoke: (user: any) => Injection.getAll(user, {})},
    {name: "Specimen.getById", model: Specimen, query: "findByPk", invoke: (user: any) => Specimen.getById(user, "id-1")},
    {name: "Neuron.getAll", model: Neuron, query: "findAll", invoke: (user: any) => Neuron.getAll(user, {})}
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe("denial", () => {
    for (const entryPoint of entryPoints) {
        test(`${entryPoint.name} rejects a None user without querying`, async () => {
            const query = vi.spyOn(entryPoint.model, entryPoint.query).mockResolvedValue([] as any);

            await expect(entryPoint.invoke(userWithPermissions(UserPermissions.None))).rejects.toThrow(UnauthorizedError);

            expect(query).not.toHaveBeenCalled();
        });

        test(`${entryPoint.name} rejects a null user without querying`, async () => {
            const query = vi.spyOn(entryPoint.model, entryPoint.query).mockResolvedValue([] as any);

            await expect(entryPoint.invoke(null)).rejects.toThrow(UnauthorizedError);

            expect(query).not.toHaveBeenCalled();
        });
    }
});

describe("delegation", () => {
    test("Genotype.getById queries for the weakest non-zero permission", async () => {
        const findByPk = vi.spyOn(Genotype, "findByPk").mockResolvedValue({id: "id-1"} as any);

        const genotype = await Genotype.getById(userWithPermissions(UserPermissions.AnnotateOne), "id-1");

        expect(genotype).toEqual({id: "id-1"});
        expect(findByPk).toHaveBeenCalledTimes(1);
    });

    test("Injection.getById queries for the weakest non-zero permission", async () => {
        const findByPk = vi.spyOn(Injection, "findByPk").mockResolvedValue({id: "id-1"} as any);

        const injection = await Injection.getById(userWithPermissions(UserPermissions.AnnotateOne), "id-1");

        expect(injection).toEqual({id: "id-1"});
        expect(findByPk).toHaveBeenCalledTimes(1);
    });

    test("Injection.getAll queries for the weakest non-zero permission", async () => {
        const findAll = vi.spyOn(Injection, "findAll").mockResolvedValue([] as any);

        const injections = await Injection.getAll(userWithPermissions(UserPermissions.AnnotateOne), {});

        expect(injections).toEqual([]);
        expect(findAll).toHaveBeenCalledTimes(1);
    });

    test("Specimen.getById queries for the weakest non-zero permission", async () => {
        const findByPk = vi.spyOn(Specimen, "findByPk").mockResolvedValue({id: "id-1"} as any);

        const specimen = await Specimen.getById(userWithPermissions(UserPermissions.AnnotateOne), "id-1");

        expect(specimen).toEqual({id: "id-1"});
        expect(findByPk).toHaveBeenCalledTimes(1);
    });
});
