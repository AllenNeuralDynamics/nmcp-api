import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus, PhaseFailureStatuses} = require("../src/models/atlasReconstructionStatus");
const {secureResolvers} = require("../src/graphql/secureResolvers");

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

const reviewer = userWith(UserPermissions.PublishReview);

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * What these pin is that each parent status carries its own atlas predicate and replacement, that a status left
 * unfiltered matches on status alone, and that an empty atlas list adds no predicate at all - ARRAY[] with an empty
 * replacement is a Postgres type error.
 */
describe("Reconstruction.getAll statusFilters", () => {
    function queryable() {
        vi.spyOn(Reconstruction as any, "setSortAndLimiting").mockResolvedValue(0);

        return {findAll: vi.spyOn(Reconstruction, "findAll").mockResolvedValue([])};
    }

    const optionsFrom = (findAll: any) => findAll.mock.calls[0][0];

    const failedStatuses = [AtlasReconstructionStatus.FailedStructureAssignment, AtlasReconstructionStatus.FailedSearchIndexing];

    const atlasLiteral = (clause: any) => clause[Op.and][1].val as string;

    test("narrows only the status that asks for it", async () => {
        const stubs = queryable();

        await Reconstruction.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [
                {status: ReconstructionStatus.Publishing},
                {status: ReconstructionStatus.WaitingForAtlasReconstruction, atlasStatus: failedStatuses}
            ]
        });

        const options = optionsFrom(stubs.findAll);
        const clauses = options.where[Op.or];

        expect(clauses).toHaveLength(2);
        expect(clauses[0]).toEqual({status: ReconstructionStatus.Publishing});
        expect(clauses[1][Op.and][0]).toEqual({status: ReconstructionStatus.WaitingForAtlasReconstruction});

        const atlas = atlasLiteral(clauses[1]);

        expect(atlas).toContain(`"AtlasReconstruction" AS atlas_child`);
        // Correlated on the parent's own id, not neuronId as the keyword predicate is.
        expect(atlas).toContain(`atlas_child."reconstructionId" = "Reconstruction"."id"`);
        // Explicit, because a raw literal bypasses the paranoid scope.
        expect(atlas).toContain(`atlas_child."deletedAt" IS NULL`);
        expect(atlas).toContain(`ANY(ARRAY[:reconstructionAtlasStatus1])`);

        expect(options.replacements).toEqual({reconstructionAtlasStatus1: failedStatuses});
    });

    test("gives each narrowed status its own replacement", async () => {
        const stubs = queryable();

        await Reconstruction.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [
                {status: ReconstructionStatus.WaitingForAtlasReconstruction, atlasStatus: failedStatuses},
                {status: ReconstructionStatus.ReadyToPublish, atlasStatus: [AtlasReconstructionStatus.FailedPrecomputed]}
            ]
        });

        const options = optionsFrom(stubs.findAll);
        const clauses = options.where[Op.or];

        expect(atlasLiteral(clauses[0])).toContain(`ANY(ARRAY[:reconstructionAtlasStatus0])`);
        expect(atlasLiteral(clauses[1])).toContain(`ANY(ARRAY[:reconstructionAtlasStatus1])`);

        expect(options.replacements).toEqual({
            reconstructionAtlasStatus0: failedStatuses,
            reconstructionAtlasStatus1: [AtlasReconstructionStatus.FailedPrecomputed]
        });
    });

    test.each([
        {label: "an empty", atlasStatus: []},
        {label: "an absent", atlasStatus: undefined}
    ])("matches on status alone for $label atlas list", async ({atlasStatus}) => {
        const stubs = queryable();

        await Reconstruction.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [{status: ReconstructionStatus.WaitingForAtlasReconstruction, atlasStatus: atlasStatus}]
        });

        const options = optionsFrom(stubs.findAll);

        expect(options.where[Op.or]).toEqual([{status: ReconstructionStatus.WaitingForAtlasReconstruction}]);
        expect(options.replacements).toBeUndefined();
    });

    test("treats a plain status list as filters with no atlas narrowing", async () => {
        const stubs = queryable();

        await Reconstruction.getAll(reviewer, {
            status: [ReconstructionStatus.Publishing, ReconstructionStatus.WaitingForAtlasReconstruction],
            offset: 0,
            limit: 10
        });

        const options = optionsFrom(stubs.findAll);

        expect(options.where[Op.or]).toEqual([
            {status: ReconstructionStatus.Publishing},
            {status: ReconstructionStatus.WaitingForAtlasReconstruction}
        ]);
        expect(options.replacements).toBeUndefined();
    });

    test("refuses status and statusFilters together without querying", async () => {
        const stubs = queryable();

        await expect(Reconstruction.getAll(reviewer, {
            status: [ReconstructionStatus.Publishing],
            offset: 0,
            limit: 10,
            statusFilters: [{status: ReconstructionStatus.WaitingForAtlasReconstruction, atlasStatus: failedStatuses}]
        })).rejects.toThrow("not both");

        expect(stubs.findAll).not.toHaveBeenCalled();
    });

    test("keeps the atlas predicate when the keyword filter is used as well", async () => {
        const stubs = queryable();

        await Reconstruction.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [{status: ReconstructionStatus.WaitingForAtlasReconstruction, atlasStatus: [AtlasReconstructionStatus.FailedPrecomputed]}],
            keywords: ["cortex"]
        });

        const options = optionsFrom(stubs.findAll);

        expect(atlasLiteral(options.where[Op.or][0])).toContain("atlas_child");
        expect(options.where[Op.and].map((clause: any) => clause.val as string)[0]).toContain("keyword_neuron");

        expect(options.replacements).toEqual({
            reconstructionAtlasStatus0: [AtlasReconstructionStatus.FailedPrecomputed],
            reconstructionKeywords: ["%cortex%"]
        });
    });
});

describe("Reconstruction.phaseFailure", () => {
    const resolve = (reconstruction: any) => secureResolvers.Reconstruction.phaseFailure(reconstruction);

    function parent(child: any) {
        const instance = Object.create(Reconstruction.prototype);

        Object.assign(instance, {
            id: "reconstruction-1",
            status: ReconstructionStatus.WaitingForAtlasReconstruction,
            AtlasReconstruction: child,
            getAtlasReconstruction: vi.fn().mockResolvedValue(child)
        });

        return instance;
    }

    function failedChild(status: number) {
        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            status: status,
            failureReason: "a recorded reason",
            failedAt: new Date("2026-03-01")
        });

        return instance;
    }

    test.each(PhaseFailureStatuses as number[])("reports a child at %s", async (status: any) => {
        const failure = await resolve(parent(failedChild(status)));

        expect(failure).toEqual({phase: status, reason: "a recorded reason", failedAt: new Date("2026-03-01")});
    });

    // Not every non-pending status is a failure, and an In... status is work in flight rather than a blocked phase.
    test.each([
        ["Published", AtlasReconstructionStatus.Published],
        ["PendingQualityControl", AtlasReconstructionStatus.PendingQualityControl],
        ["InDoiAssignment", AtlasReconstructionStatus.InDoiAssignment],
        ["ReadyToPublish", AtlasReconstructionStatus.ReadyToPublish]
    ])("is null for a child at %s", async (_label: string, status: number) => {
        expect(await resolve(parent(failedChild(status)))).toBeNull();
    });

    test("is null when the reconstruction has no atlas child", async () => {
        const reconstruction = parent(null);

        expect(await resolve(reconstruction)).toBeNull();
    });

    test("reports a null reason for a child that failed before the columns existed", async () => {
        const child = failedChild(AtlasReconstructionStatus.FailedQualityControl);

        child.failureReason = null;
        child.failedAt = null;

        expect(await resolve(parent(child))).toEqual({
            phase: AtlasReconstructionStatus.FailedQualityControl,
            reason: null,
            failedAt: null
        });
    });

    test("falls back to a fetch only when the association is not loaded", async () => {
        const child = failedChild(AtlasReconstructionStatus.FailedPrecomputed);
        const reconstruction = parent(child);

        await resolve(reconstruction);
        expect(reconstruction.getAtlasReconstruction).not.toHaveBeenCalled();

        reconstruction.AtlasReconstruction = undefined;

        expect(await resolve(reconstruction)).toMatchObject({phase: AtlasReconstructionStatus.FailedPrecomputed});
        expect(reconstruction.getAtlasReconstruction).toHaveBeenCalledTimes(1);
    });
});

/**
 * The list query is the only place the eager-load matters: without the include both child fields fall back to a
 * fetch per row, and a unit test over one pre-populated instance would pass either way.
 */
describe("the reconstructions list query loads the child once", () => {
    test("hands getAll the atlas reconstruction include", async () => {
        const getAll = vi.spyOn(Reconstruction, "getAll").mockResolvedValue({total: 0, offset: 0, reconstructions: []} as any);

        await secureResolvers.Query.reconstructions({}, {queryArgs: {status: [], offset: 0, limit: 10}}, reviewer);

        expect(getAll.mock.calls[0][2]).toEqual([{model: AtlasReconstruction}]);
    });

    test("neither phaseFailure nor atlasReconstruction fetches per row when the include ran", async () => {
        const rows = [
            AtlasReconstructionStatus.FailedQualityControl,
            AtlasReconstructionStatus.Published,
            AtlasReconstructionStatus.FailedSearchIndexing
        ].map((status, index) => {
            const child = Object.create(AtlasReconstruction.prototype);

            Object.assign(child, {id: `atlas-${index}`, status: status, failureReason: "r", failedAt: new Date("2026-03-01")});

            const reconstruction = Object.create(Reconstruction.prototype);

            Object.assign(reconstruction, {
                id: `reconstruction-${index}`,
                AtlasReconstruction: child,
                getAtlasReconstruction: vi.fn().mockResolvedValue(child)
            });

            return reconstruction;
        });

        for (const row of rows) {
            await secureResolvers.Reconstruction.phaseFailure(row);
            await secureResolvers.Reconstruction.atlasReconstruction(row);

            expect(row.getAtlasReconstruction).not.toHaveBeenCalled();
        }

        // Two of the three are blocked; the published one is not.
        const failures = await Promise.all(rows.map(row => secureResolvers.Reconstruction.phaseFailure(row)));

        expect(failures.filter(Boolean)).toHaveLength(2);
    });
});

/**
 * tsc proves the field exists; it cannot prove the resolver reads the right association alias or asks for the column
 * the system-user check depends on.  Under an explicit attribute projection an unrequested isSystemUser is undefined,
 * so the check would pass every system user through.
 */
describe.each([
    {field: "reviewer", getter: "getReviewer", foreignKey: "reviewerId", permission: UserPermissions.PeerReview},
    {field: "teamReviewer", getter: "getTeamReviewer", foreignKey: "teamReviewerId", permission: UserPermissions.TeamReview}
] as const)("Reconstruction.$field", ({field, getter, foreignKey, permission}) => {
    const resolve = (reconstruction: any) => secureResolvers.Reconstruction[field](reconstruction);

    function parent(associated: any) {
        const instance = Object.create(Reconstruction.prototype);

        Object.assign(instance, {
            id: "reconstruction-1",
            [foreignKey]: associated ? "associated-1" : null,
            [getter]: vi.fn().mockResolvedValue(associated)
        });

        return instance;
    }

    test("returns the user the association resolves", async () => {
        const user = Object.assign(userWith(permission, "associated-1"), {isSystemUser: false});

        expect(await resolve(parent(user))).toBe(user);
    });

    test("requests isSystemUser, without which the check below is worthless", async () => {
        const instance = parent(Object.assign(userWith(permission, "associated-1"), {isSystemUser: false}));

        await resolve(instance);

        expect(instance[getter]).toHaveBeenCalledWith({attributes: ["id", "firstName", "lastName", "isSystemUser"]});
    });

    test("returns null for a system user", async () => {
        const system = Object.assign(userWith(UserPermissions.InternalSystem, "system-1"), {isSystemUser: true});

        expect(await resolve(parent(system))).toBeNull();
    });

    test("returns null when there is none", async () => {
        expect(await resolve(parent(null))).toBeNull();
    });
});
