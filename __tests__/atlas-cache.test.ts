import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Atlas} = require("../src/models/atlas");
const {AtlasKind, AtlasKindId} = require("../src/models/atlasKind");

function fakeAtlas(id: string, atlasKindId: string, subtrees: Record<string, string[]>) {
    const atlas = Object.create(Atlas.prototype);

    atlas.id = id;
    atlas.atlasKindId = atlasKindId;
    atlas._structureById = new Map(Object.keys(subtrees).map(structureId => [structureId, {id: structureId}]));
    atlas._structureTreeById = new Map(Object.entries(subtrees));
    atlas.loadCompartmentCache = vi.fn().mockResolvedValue(undefined);

    return atlas;
}

// The real loadCache runs over these, so the cache code is exercised rather than mocked.
async function load(atlases: any[]) {
    const findAll = vi.spyOn(Atlas, "findAll").mockResolvedValue(atlases);

    await Atlas.loadCache();

    return findAll;
}

const mouse = fakeAtlas("atlas-mouse", "kind-mouse", {
    "mouse-root": ["mouse-root", "mouse-a", "mouse-a-child"],
    "mouse-a": ["mouse-a", "mouse-a-child"],
    "mouse-a-child": ["mouse-a-child"]
});

const marmoset = fakeAtlas("atlas-marmoset", "kind-marmoset", {
    "marmoset-root": ["marmoset-root", "marmoset-a"],
    "marmoset-a": ["marmoset-a"]
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("loadCache", () => {
    test("loads atlases oldest first and keeps that order", async () => {
        const findAll = await load([marmoset, mouse]);

        expect(findAll).toHaveBeenCalledWith({order: [["createdAt", "ASC"]]});
        expect(Atlas.getAll()).toEqual([marmoset, mouse]);
    });

    test("refuses to start with no atlases", async () => {
        vi.spyOn(Atlas, "findAll").mockResolvedValue([]);

        await expect(Atlas.loadCache()).rejects.toThrow(/At least one atlas is required/);
    });

    test("a reload replaces the previous cache", async () => {
        await load([mouse, marmoset]);
        await load([marmoset]);

        expect(Atlas.getAll()).toEqual([marmoset]);
        expect(Atlas.getAtlas("atlas-mouse")).toBeUndefined();
        expect(Atlas.getAtlasForStructure("mouse-a")).toBeNull();
        expect(Atlas.getAtlasForStructure("marmoset-a")).toBe(marmoset);
    });
});

describe("getAtlasForStructure", () => {
    test("returns the owning atlas for structures of each atlas", async () => {
        await load([mouse, marmoset]);

        expect(Atlas.getAtlasForStructure("mouse-a-child")).toBe(mouse);
        expect(Atlas.getAtlasForStructure("marmoset-root")).toBe(marmoset);
    });

    test("returns null for an unknown structure", async () => {
        await load([mouse, marmoset]);

        expect(Atlas.getAtlasForStructure("unknown")).toBeNull();
    });
});

describe("getForKind", () => {
    test("returns only the loaded atlases of that kind, in load order", async () => {
        const secondMouse = fakeAtlas("atlas-mouse-2", "kind-mouse", {"second-root": ["second-root"]});

        await load([mouse, marmoset, secondMouse]);

        expect(Atlas.getForKind("kind-mouse")).toEqual([mouse, secondMouse]);
        expect(Atlas.getForKind("kind-marmoset")).toEqual([marmoset]);
    });

    test("returns an empty list for a kind with no loaded atlas", async () => {
        await load([mouse]);

        expect(Atlas.getForKind("kind-marmoset")).toEqual([]);
    });
});

describe("getComprehensiveBrainAreas", () => {
    test("expands one structure to its subtree", async () => {
        await load([mouse, marmoset]);

        expect(Atlas.getComprehensiveBrainAreas(["mouse-a"])).toEqual(["mouse-a", "mouse-a-child"]);
    });

    test("unions structures across atlases", async () => {
        await load([mouse, marmoset]);

        const areas = Atlas.getComprehensiveBrainAreas(["mouse-a", "marmoset-root"]);

        expect(areas).toEqual(expect.arrayContaining(["mouse-a", "mouse-a-child", "marmoset-root", "marmoset-a"]));
        expect(areas).toHaveLength(4);
    });

    test("dedupes a parent selected with its child", async () => {
        await load([mouse, marmoset]);

        expect(Atlas.getComprehensiveBrainAreas(["mouse-a", "mouse-a-child"])).toEqual(["mouse-a", "mouse-a-child"]);
    });

    test("lists every unknown structure", async () => {
        await load([mouse, marmoset]);

        expect(() => Atlas.getComprehensiveBrainAreas(["x", "mouse-a", "y"])).toThrow("Atlas structures not found: x, y");
    });
});

describe("getComprehensiveBrainAreasByAtlas", () => {
    test("groups each expansion under the atlas of the selected structure", async () => {
        await load([mouse, marmoset]);

        const areasByAtlas = Atlas.getComprehensiveBrainAreasByAtlas(["mouse-a", "marmoset-root"]);

        expect([...areasByAtlas.keys()]).toEqual(["atlas-mouse", "atlas-marmoset"]);
        expect(areasByAtlas.get("atlas-mouse")).toEqual(["mouse-a", "mouse-a-child"]);
        expect(areasByAtlas.get("atlas-marmoset")).toEqual(["marmoset-root", "marmoset-a"]);
    });

    test("dedupes within an atlas", async () => {
        await load([mouse, marmoset]);

        const areasByAtlas = Atlas.getComprehensiveBrainAreasByAtlas(["mouse-root", "mouse-a"]);

        expect([...areasByAtlas.keys()]).toEqual(["atlas-mouse"]);
        expect(areasByAtlas.get("atlas-mouse")).toEqual(["mouse-root", "mouse-a", "mouse-a-child"]);
    });

    test("lists every unknown structure", async () => {
        await load([mouse, marmoset]);

        expect(() => Atlas.getComprehensiveBrainAreasByAtlas(["x", "mouse-a"])).toThrow("Atlas structures not found: x");
    });
});

describe("loadCompartmentCache", () => {
    test("descendant lookup is scoped to the owning atlas", async () => {
        const {AtlasStructure} = require("../src/models/atlasStructure");

        const root = {id: "root", name: "root", acronym: "root", safeName: "root", structureId: 997, structureIdPath: "/997/"};

        const findAll = vi.spyOn(AtlasStructure, "findAll").mockResolvedValue([root]);

        const atlas = Object.create(Atlas.prototype);
        atlas.id = "atlas-shared-root";
        atlas._structureTreeById = new Map();
        atlas._structureById = new Map();
        atlas._structureByName = new Map();
        atlas._structureByAcronym = new Map();
        atlas._structureBySafeName = new Map();
        atlas._structureByStructureId = new Map();

        await atlas.loadCompartmentCache();

        const descendantQuery = findAll.mock.calls[1][0] as any;

        expect(descendantQuery.where.atlasId).toBe("atlas-shared-root");
        expect(descendantQuery.where.structureIdPath).toBeDefined();
    });
});

describe("findFirstOfKind", () => {
    const firstMouse = fakeAtlas("atlas-mouse-1", "kind-mouse", {"first-root": ["first-root"]});
    const secondMouse = fakeAtlas("atlas-mouse-2", "kind-mouse", {"second-root": ["second-root"]});

    test("returns the first-loaded atlas of that kind, skipping atlases of another kind", async () => {
        await load([marmoset, firstMouse, secondMouse]);

        const findKinds = vi.spyOn(AtlasKind, "findAll").mockResolvedValue([{id: "kind-mouse"}]);

        expect(await Atlas.findFirstOfKind(AtlasKindId.Mouse)).toBe(firstMouse);
        expect(findKinds).toHaveBeenCalledWith({where: {kind: AtlasKindId.Mouse}, attributes: ["id"]});
    });

    test("returns null when no atlas is of that kind", async () => {
        await load([marmoset]);

        vi.spyOn(AtlasKind, "findAll").mockResolvedValue([{id: "kind-mouse"}]);

        expect(await Atlas.findFirstOfKind(AtlasKindId.Mouse)).toBeNull();
    });
});

describe("findForLocation without a spatial volume", () => {
    function volumeless() {
        const atlas = Object.create(Atlas.prototype);
        atlas._rootId = "root-1";
        return atlas;
    }

    test("returns null without the fallback", () => {
        expect(volumeless().findForLocation({x: 1, y: 1, z: 1}, false)).toBeNull();
    });

    test("returns the root with the fallback", () => {
        expect(volumeless().findForLocation({x: 1, y: 1, z: 1}, true)).toBe("root-1");
    });

    test("a negative coordinate still returns null", () => {
        expect(volumeless().findForLocation({x: -1, y: 1, z: 1}, true)).toBeNull();
    });
});
