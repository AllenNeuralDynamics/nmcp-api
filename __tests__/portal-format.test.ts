import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
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
            doi: "10.0000/atlas-1",
            Reviewer: portalUser("proofreader-1"),
            Reconstruction: Object.assign(Object.create(Reconstruction.prototype), {
                id: "reconstruction-1",
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
    test("eager-loads TeamReviewer inside the nested Reconstruction include", async () => {
        const findByPk = stub(atlasStub({TeamReviewer: portalUser("team-reviewer-1")}));

        await AtlasReconstruction.toPortalFormat(exporter, "atlas-1");

        const includes = (findByPk.mock.calls[0][1] as any).include;
        const nested = includes.find((include: any) => include.model === Reconstruction);

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

    test("emits the parent's publish date when found through the reconstruction id", async () => {
        const instance = atlasStub({publishedAt: parentDate});
        instance.publishedAt = atlasDate;

        vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(null);
        vi.spyOn(Reconstruction, "findByPk").mockResolvedValue({id: "reconstruction-1"});
        vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(instance);
        vi.spyOn(AtlasReconstruction, "serializeNodes").mockResolvedValue([]);

        const portal = await AtlasReconstruction.toPortalFormat(exporter, "reconstruction-1");

        expect(portal.publishedAt).toBe(parentDate);
    });

    test("refuses a caller without InternalAccess", async () => {
        const caller = Object.create(User.prototype);
        caller.permissions = UserPermissions.Admin | UserPermissions.ReviewAll;

        await expect(AtlasReconstruction.toPortalFormat(caller, "atlas-1")).rejects.toThrow();
    });
});

describe("Reconstruction.toPortalFormat", () => {
    function specimenStub(overrides: object = {}) {
        return Object.assign(Object.create(Reconstruction.prototype), {
            id: "reconstruction-1",
            Neuron: neuronStub(),
            Annotator: portalUser("annotator-1"),
            Reviewer: portalUser("peer-reviewer-1"),
            TeamReviewer: null,
            ...overrides
        });
    }

    function stub(instance: any) {
        vi.spyOn(Reconstruction, "serializeNodes").mockResolvedValue([]);

        return vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(instance);
    }

    test("emits the contributors the associations carry", async () => {
        stub(specimenStub({TeamReviewer: portalUser("team-reviewer-1")}));

        const portal = await Reconstruction.toPortalFormat(exporter, "reconstruction-1");

        expect(portal.annotationSpace).toBe(PortalAnnotationSpace.Specimen);
        expect(portal.annotator).toMatchObject({id: "annotator-1", affiliation: "An Institute"});
        expect(portal.peerReviewer).toMatchObject({id: "peer-reviewer-1"});
        expect(portal.teamReviewer).toMatchObject({id: "team-reviewer-1"});
    });

    test("emits null when the reconstruction skipped team review", async () => {
        stub(specimenStub());

        const portal = await Reconstruction.toPortalFormat(exporter, "reconstruction-1");

        expect(portal.teamReviewer).toBeNull();
        expect(portal.peerReviewer).toMatchObject({id: "peer-reviewer-1"});
    });

    test("emits null for a system team reviewer", async () => {
        stub(specimenStub({TeamReviewer: portalUser("system-1", true)}));

        const portal = await Reconstruction.toPortalFormat(exporter, "reconstruction-1");

        expect(portal.teamReviewer).toBeNull();
    });

    // The assertion that keeps the three contributor fields from going permanently null.
    test("eager-loads Annotator, Reviewer and TeamReviewer", async () => {
        const findByPk = stub(specimenStub({TeamReviewer: portalUser("team-reviewer-1")}));

        await Reconstruction.toPortalFormat(exporter, "reconstruction-1");

        const includes = (findByPk.mock.calls[0][1] as any).include;

        expect(includes).toEqual(expect.arrayContaining([
            {model: User, as: "Annotator"},
            {model: User, as: "Reviewer"},
            {model: User, as: "TeamReviewer"}
        ]));
    });

    test("emits the publish date", async () => {
        stub(specimenStub({publishedAt: parentDate}));

        const portal = await Reconstruction.toPortalFormat(exporter, "reconstruction-1");

        expect(portal.publishedAt).toBe(parentDate);
        expect(portal.doi).toBeNull();
    });

    test("emits null when unpublished", async () => {
        stub(specimenStub());

        const portal = await Reconstruction.toPortalFormat(exporter, "reconstruction-1");

        expect(portal.publishedAt).toBeNull();
        expect(portal.doi).toBeNull();
    });

    test("refuses a caller without InternalAccess", async () => {
        const caller = Object.create(User.prototype);
        caller.permissions = UserPermissions.Admin | UserPermissions.ReviewAll;

        await expect(Reconstruction.toPortalFormat(caller, "reconstruction-1")).rejects.toThrow();
    });
});

describe("Neuron.toPortalFormat", () => {
    function neuron(canonicalDoi: string | null | undefined) {
        return Object.assign(Object.create(Neuron.prototype), {
            id: "neuron-1",
            label: "N1",
            canonicalDoi: canonicalDoi,
            Specimen: {toPortalFormat: () => null}
        });
    }

    test("emits a set canonical DOI", () => {
        expect(neuron("10.48813/abcd-1234").toPortalFormat().canonicalDoi).toBe("10.48813/abcd-1234");
    });

    test("trims surrounding whitespace", () => {
        expect(neuron(" 10.48813/abcd-1234 ").toPortalFormat().canonicalDoi).toBe("10.48813/abcd-1234");
    });

    test.each([null, undefined, "", "   "])("emits null for %j", (value: string | null | undefined) => {
        expect(neuron(value).toPortalFormat().canonicalDoi).toBeNull();
    });

    test("still emits the id, label and specimen", () => {
        const specimen = {id: "specimen-1"};
        const instance = neuron("10.48813/abcd-1234");
        instance.Specimen = {toPortalFormat: () => specimen};

        const portal = instance.toPortalFormat();

        expect(portal.id).toBe("neuron-1");
        expect(portal.label).toBe("N1");
        expect(portal.specimen).toBe(specimen);
    });
});
