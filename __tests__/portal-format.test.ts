import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {Neuron} = require("../src/models/neuron");
const {PortalAnnotationSpace} = require("../src/io/portalFormat");

// Both producers are gated on canRequestReconstructionData, which is InternalAccess alone with no admin bypass.
const exporter = (() => {
    const user = Object.create(User.prototype);
    user.id = "export-service";
    user.permissions = UserPermissions.InternalAccess;
    return user;
})();

function portalUser(id: string, isSystemUser: boolean = false) {
    const user = Object.create(User.prototype);

    Object.assign(user, {
        id: id,
        firstName: "Given",
        lastName: id,
        affiliation: "An Institute",
        emailAddress: `${id}@example.org`,
        isSystemUser: isSystemUser
    });

    return user;
}

function neuronStub() {
    return {toPortalFormat: () => ({id: "neuron-1", label: "N1", canonicalDoi: null, specimen: null})};
}

// Distinct dates, so a mix-up between the parent's and the atlas row's shows in the failure.
const parentDate = new Date("2026-03-01T12:00:00Z");
const atlasDate = new Date("2026-04-15T08:30:00Z");

afterEach(() => {
    vi.restoreAllMocks();
});

describe("AtlasReconstruction.toPortalFormat", () => {
    function atlasStub(overrides: object = {}) {
        const instance = Object.create(AtlasReconstruction.prototype);

        Object.assign(instance, {
            id: "atlas-1",
            Reviewer: portalUser("proofreader-1"),
            Annotation: Object.assign(Object.create(Annotation.prototype), {
                id: "annotation-1",
                doi: "10.0000/atlas-1",
                Neuron: neuronStub(),
                Annotator: portalUser("annotator-1"),
                Reviewer: portalUser("peer-reviewer-1"),
                TeamReviewer: null,
                ...overrides
            })
        });

        return instance;
    }

    function stub(instance: any) {
        vi.spyOn(AtlasReconstruction, "serializeNodes").mockResolvedValue([]);

        return vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(instance);
    }

    test("emits the team reviewer the nested association carries", async () => {
        stub(atlasStub({TeamReviewer: portalUser("team-reviewer-1")}));

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.annotationSpace).toBe(PortalAnnotationSpace.Atlas);
        expect(portal.teamReviewer).toMatchObject({id: "team-reviewer-1", affiliation: "An Institute"});
    });

    test("emits null when the reconstruction skipped team review", async () => {
        stub(atlasStub());

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.teamReviewer).toBeNull();
        expect(portal.peerReviewer).toMatchObject({id: "peer-reviewer-1"});
    });

    test("emits null for a system team reviewer", async () => {
        stub(atlasStub({TeamReviewer: portalUser("system-1", true)}));

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.teamReviewer).toBeNull();
    });

    // The assertion that keeps the field from going permanently null: the value is read off an association the
    // query has to ask for.
    test("eager-loads TeamReviewer inside the nested Annotation include", async () => {
        const findByPk = stub(atlasStub({TeamReviewer: portalUser("team-reviewer-1")}));

        await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        const includes = (findByPk.mock.calls[0][1] as any).include;
        const nested = includes.find((include: any) => include.model === Annotation);

        expect(nested.include).toEqual(expect.arrayContaining([{model: User, as: "TeamReviewer"}]));
    });

    test("emits the parent's publish date, not the atlas row's", async () => {
        const instance = atlasStub({publishedAt: parentDate});
        instance.publishedAt = atlasDate;
        stub(instance);

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.publishedAt).toBe(parentDate);
        expect(portal.doi).toBe("10.0000/atlas-1");
    });

    test("emits null when the parent is unpublished, whatever the atlas row holds", async () => {
        const instance = atlasStub();
        instance.publishedAt = atlasDate;
        stub(instance);

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.publishedAt).toBeNull();
    });

    test("emits null when the annotation's DOI is empty", async () => {
        stub(atlasStub({doi: ""}));

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.doi).toBeNull();
    });

    test("emits the parent's publish date when found through the annotation id", async () => {
        const instance = atlasStub({publishedAt: parentDate});
        instance.publishedAt = atlasDate;

        vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(null);
        vi.spyOn(Annotation, "findByPk").mockResolvedValue({id: "annotation-1"});
        const findOne = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(instance);
        vi.spyOn(AtlasReconstruction, "serializeNodes").mockResolvedValue([]);

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "annotation-1");

        expect(portal.publishedAt).toBe(parentDate);
        expect((findOne.mock.calls[0][0] as any).where).toEqual({annotationId: "annotation-1"});
    });

    test("refuses a caller without InternalAccess", async () => {
        const caller = Object.create(User.prototype);
        caller.permissions = UserPermissions.Admin | UserPermissions.ReviewAll;

        await expect(AtlasReconstruction.toPortalFormat(caller, "atlas-1")).rejects.toThrow();
    });
});

describe("SpecimenSpaceReconstruction.toPortalFormat", () => {
    function specimenStub(overrides: object = {}) {
        return Object.assign(Object.create(SpecimenSpaceReconstruction.prototype), {
            id: "specimen-space-1",
            annotationId: "annotation-1",
            Annotation: Object.assign(Object.create(Annotation.prototype), {
                id: "annotation-1",
                Neuron: neuronStub(),
                Annotator: portalUser("annotator-1"),
                Reviewer: portalUser("peer-reviewer-1"),
                TeamReviewer: null,
                ...overrides
            })
        });
    }

    function stub(instance: any) {
        vi.spyOn(SpecimenSpaceReconstruction, "serializeNodes").mockResolvedValue([]);

        return vi.spyOn(SpecimenSpaceReconstruction, "findByPk").mockResolvedValue(instance);
    }

    test("emits the contributors the associations carry", async () => {
        stub(specimenStub({TeamReviewer: portalUser("team-reviewer-1")}));

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.annotationSpace).toBe(PortalAnnotationSpace.Specimen);
        expect(portal.annotator).toMatchObject({id: "annotator-1", affiliation: "An Institute"});
        expect(portal.peerReviewer).toMatchObject({id: "peer-reviewer-1"});
        expect(portal.teamReviewer).toMatchObject({id: "team-reviewer-1"});
    });

    test("emits null when the annotation skipped team review", async () => {
        stub(specimenStub());

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.teamReviewer).toBeNull();
        expect(portal.peerReviewer).toMatchObject({id: "peer-reviewer-1"});
    });

    test("emits null for a system team reviewer", async () => {
        stub(specimenStub({TeamReviewer: portalUser("system-1", true)}));

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.teamReviewer).toBeNull();
    });

    // The assertion that keeps the three contributor fields from going permanently null.
    test("eager-loads Annotator, Reviewer and TeamReviewer inside the nested Annotation include", async () => {
        const findByPk = stub(specimenStub({TeamReviewer: portalUser("team-reviewer-1")}));

        await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        const includes = (findByPk.mock.calls[0][1] as any).include;
        const nested = includes.find((include: any) => include.model === Annotation);

        expect(nested.include).toEqual(expect.arrayContaining([
            {model: User, as: "Annotator"},
            {model: User, as: "Reviewer"},
            {model: User, as: "TeamReviewer"}
        ]));
    });

    test("emits the annotation's publish date", async () => {
        stub(specimenStub({publishedAt: parentDate}));

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.publishedAt).toBe(parentDate);
        expect(portal.doi).toBeNull();
    });

    test("emits the annotation's DOI", async () => {
        stub(specimenStub({doi: "10.0000/annotation-1"}));

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.doi).toBe("10.0000/annotation-1");
    });

    test("emits null when the annotation's DOI is empty", async () => {
        stub(specimenStub({doi: ""}));

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.doi).toBeNull();
    });

    test("emits null when unpublished", async () => {
        stub(specimenStub());

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.publishedAt).toBeNull();
        expect(portal.doi).toBeNull();
    });

    test("refuses a caller without InternalAccess", async () => {
        const caller = Object.create(User.prototype);
        caller.permissions = UserPermissions.Admin | UserPermissions.ReviewAll;

        await expect(SpecimenSpaceReconstruction.toPortalFormat(caller, "specimen-space-1")).rejects.toThrow();
    });
});

describe("SpecimenSpaceReconstruction.toPortalFormat lookup", () => {
    function lookup(options: { byId?: any, byAnnotation?: any, atlas?: any }) {
        vi.spyOn(SpecimenSpaceReconstruction, "serializeNodes").mockResolvedValue([]);

        return {
            findByPk: vi.spyOn(SpecimenSpaceReconstruction, "findByPk").mockResolvedValue(options.byId ?? null),
            findOne: vi.spyOn(SpecimenSpaceReconstruction, "findOne").mockImplementation(async (query: any) =>
                query.where.annotationId === "annotation-1" ? options.byAnnotation ?? null : null),
            findAtlas: vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(options.atlas ?? null)
        };
    }

    function row() {
        return Object.assign(Object.create(SpecimenSpaceReconstruction.prototype), {
            id: "specimen-space-1",
            annotationId: "annotation-1",
            Annotation: {Neuron: neuronStub(), Annotator: null, Reviewer: null, TeamReviewer: null}
        });
    }

    test("a specimen-space id is found directly", async () => {
        const stubs = lookup({byId: row()});

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "specimen-space-1");

        expect(portal.id).toBe("specimen-space-1");
        expect(stubs.findByPk.mock.calls[0][0]).toBe("specimen-space-1");
        expect(stubs.findOne).not.toHaveBeenCalled();
        expect(stubs.findAtlas).not.toHaveBeenCalled();
    });

    test("an annotation id falls through to the annotation's row", async () => {
        const stubs = lookup({byAnnotation: row()});

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "annotation-1");

        expect(portal.id).toBe("specimen-space-1");
        expect(stubs.findOne.mock.calls[0][0].where).toEqual({annotationId: "annotation-1"});
        expect(stubs.findAtlas).not.toHaveBeenCalled();
    });

    test("an atlas id falls through to the atlas row's annotation", async () => {
        const stubs = lookup({byAnnotation: row(), atlas: {id: "atlas-1", annotationId: "annotation-1"}});

        const portal = await SpecimenSpaceReconstruction.toPortalFormat(exporter, "atlas-1");

        expect(portal.id).toBe("specimen-space-1");
        expect(stubs.findAtlas).toHaveBeenCalledWith("atlas-1");
        expect(stubs.findOne.mock.calls.map((call: any) => call[0].where)).toEqual([{annotationId: "atlas-1"}, {annotationId: "annotation-1"}]);
    });

    test("an unknown id returns null after all three lookups", async () => {
        const stubs = lookup({});

        expect(await SpecimenSpaceReconstruction.toPortalFormat(exporter, "unknown-1")).toBeNull();

        expect(stubs.findByPk).toHaveBeenCalledTimes(1);
        expect(stubs.findOne).toHaveBeenCalledTimes(1);
        expect(stubs.findAtlas).toHaveBeenCalledWith("unknown-1");
    });
});
