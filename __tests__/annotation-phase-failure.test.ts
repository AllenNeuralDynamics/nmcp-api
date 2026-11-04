import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {AtlasReconstructionStatus, PhaseFailureStatuses} = require("../src/models/atlasReconstructionStatus");
const {secureResolvers} = require("../src/graphql/secureResolvers");
const {createRequestContext} = require("../src/graphql/requestContext");

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
describe("Annotation.getAll statusFilters", () => {
    function queryable() {
        vi.spyOn(Annotation as any, "setSortAndLimiting").mockResolvedValue(0);

        return {findAll: vi.spyOn(Annotation, "findAll").mockResolvedValue([])};
    }

    const optionsFrom = (findAll: any) => findAll.mock.calls[0][0];

    const failedStatuses = [AtlasReconstructionStatus.FailedStructureAssignment, AtlasReconstructionStatus.FailedSearchIndexing];

    const atlasLiteral = (clause: any) => clause[Op.and][1].val as string;

    test("narrows only the status that asks for it", async () => {
        const stubs = queryable();

        await Annotation.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [
                {status: AnnotationStatus.Publishing},
                {status: AnnotationStatus.WaitingForAtlasReconstruction, atlasStatus: failedStatuses}
            ]
        });

        const options = optionsFrom(stubs.findAll);
        const clauses = options.where[Op.or];

        expect(clauses).toHaveLength(2);
        expect(clauses[0]).toEqual({status: AnnotationStatus.Publishing});
        expect(clauses[1][Op.and][0]).toEqual({status: AnnotationStatus.WaitingForAtlasReconstruction});

        const atlas = atlasLiteral(clauses[1]);

        expect(atlas).toContain(`"AtlasReconstruction" AS atlas_child`);
        // Correlated on the parent's own id, not neuronId as the keyword predicate is.
        expect(atlas).toContain(`atlas_child."annotationId" = "Annotation"."id"`);
        // Explicit, because a raw literal bypasses the paranoid scope.
        expect(atlas).toContain(`atlas_child."deletedAt" IS NULL`);
        expect(atlas).toContain(`ANY(ARRAY[:annotationAtlasStatus1])`);

        expect(options.replacements).toEqual({annotationAtlasStatus1: failedStatuses});
    });

    test("gives each narrowed status its own replacement", async () => {
        const stubs = queryable();

        await Annotation.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [
                {status: AnnotationStatus.WaitingForAtlasReconstruction, atlasStatus: failedStatuses},
                {status: AnnotationStatus.ReadyToPublish, atlasStatus: [AtlasReconstructionStatus.FailedPrecomputed]}
            ]
        });

        const options = optionsFrom(stubs.findAll);
        const clauses = options.where[Op.or];

        expect(atlasLiteral(clauses[0])).toContain(`ANY(ARRAY[:annotationAtlasStatus0])`);
        expect(atlasLiteral(clauses[1])).toContain(`ANY(ARRAY[:annotationAtlasStatus1])`);

        expect(options.replacements).toEqual({
            annotationAtlasStatus0: failedStatuses,
            annotationAtlasStatus1: [AtlasReconstructionStatus.FailedPrecomputed]
        });
    });

    test.each([
        {label: "an empty", atlasStatus: []},
        {label: "an absent", atlasStatus: undefined}
    ])("matches on status alone for $label atlas list", async ({atlasStatus}) => {
        const stubs = queryable();

        await Annotation.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [{status: AnnotationStatus.WaitingForAtlasReconstruction, atlasStatus: atlasStatus}]
        });

        const options = optionsFrom(stubs.findAll);

        expect(options.where[Op.or]).toEqual([{status: AnnotationStatus.WaitingForAtlasReconstruction}]);
        expect(options.replacements).toBeUndefined();
    });

    test("treats a plain status list as filters with no atlas narrowing", async () => {
        const stubs = queryable();

        await Annotation.getAll(reviewer, {
            status: [AnnotationStatus.Publishing, AnnotationStatus.WaitingForAtlasReconstruction],
            offset: 0,
            limit: 10
        });

        const options = optionsFrom(stubs.findAll);

        expect(options.where[Op.or]).toEqual([
            {status: AnnotationStatus.Publishing},
            {status: AnnotationStatus.WaitingForAtlasReconstruction}
        ]);
        expect(options.replacements).toBeUndefined();
    });

    test("refuses status and statusFilters together without querying", async () => {
        const stubs = queryable();

        await expect(Annotation.getAll(reviewer, {
            status: [AnnotationStatus.Publishing],
            offset: 0,
            limit: 10,
            statusFilters: [{status: AnnotationStatus.WaitingForAtlasReconstruction, atlasStatus: failedStatuses}]
        })).rejects.toThrow("not both");

        expect(stubs.findAll).not.toHaveBeenCalled();
    });

    test("keeps the atlas predicate when the keyword filter is used as well", async () => {
        const stubs = queryable();

        await Annotation.getAll(reviewer, {
            status: [],
            offset: 0,
            limit: 10,
            statusFilters: [{status: AnnotationStatus.WaitingForAtlasReconstruction, atlasStatus: [AtlasReconstructionStatus.FailedPrecomputed]}],
            keywords: ["cortex"]
        });

        const options = optionsFrom(stubs.findAll);

        expect(atlasLiteral(options.where[Op.or][0])).toContain("atlas_child");
        expect(options.where[Op.and].map((clause: any) => clause.val as string)[0]).toContain("keyword_neuron");

        expect(options.replacements).toEqual({
            annotationAtlasStatus0: [AtlasReconstructionStatus.FailedPrecomputed],
            annotationKeywords: ["%cortex%"]
        });
    });
});

describe("Annotation.phaseFailure", () => {
    const resolve = (reconstruction: any) => secureResolvers.Annotation.phaseFailure(reconstruction);

    function parent(child: any) {
        const instance = Object.create(Annotation.prototype);

        Object.assign(instance, {
            id: "annotation-1",
            status: AnnotationStatus.WaitingForAtlasReconstruction,
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
describe("the annotations list query loads the children once", () => {
    test("hands getAll the atlas and specimen-space reconstruction includes", async () => {
        const getAll = vi.spyOn(Annotation, "getAll").mockResolvedValue({total: 0, offset: 0, annotations: []} as any);

        await secureResolvers.Query.annotations({}, {queryArgs: {status: [], offset: 0, limit: 10}}, createRequestContext(reviewer));

        expect(getAll.mock.calls[0][2]).toEqual([{model: AtlasReconstruction}, {model: SpecimenSpaceReconstruction}]);
    });

    test("neither phaseFailure nor atlasReconstruction fetches per row when the include ran", async () => {
        const rows = [
            AtlasReconstructionStatus.FailedQualityControl,
            AtlasReconstructionStatus.Published,
            AtlasReconstructionStatus.FailedSearchIndexing
        ].map((status, index) => {
            const child = Object.create(AtlasReconstruction.prototype);

            Object.assign(child, {id: `atlas-${index}`, status: status, failureReason: "r", failedAt: new Date("2026-03-01")});

            const reconstruction = Object.create(Annotation.prototype);

            Object.assign(reconstruction, {
                id: `annotation-${index}`,
                AtlasReconstruction: child,
                getAtlasReconstruction: vi.fn().mockResolvedValue(child)
            });

            return reconstruction;
        });

        for (const row of rows) {
            await secureResolvers.Annotation.phaseFailure(row);
            await secureResolvers.Annotation.atlasReconstruction(row);

            expect(row.getAtlasReconstruction).not.toHaveBeenCalled();
        }

        // Two of the three are blocked; the published one is not.
        const failures = await Promise.all(rows.map(row => secureResolvers.Annotation.phaseFailure(row)));

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
] as const)("Annotation.$field", ({field, getter, foreignKey, permission}) => {
    const resolve = (reconstruction: any) => secureResolvers.Annotation[field](reconstruction);

    function parent(associated: any) {
        const instance = Object.create(Annotation.prototype);

        Object.assign(instance, {
            id: "annotation-1",
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
