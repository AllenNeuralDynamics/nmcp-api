import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {RawReconstruction} = require("../src/models/rawReconstruction");
const {RawReconstructionNode} = require("../src/models/rawReconstructionNode");
const {NeuronStructure} = require("../src/models/neuronStructure");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {PortalAnnotationSpace} = require("../src/io/portalFormat");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

const exporter = userWith(UserPermissions.InternalAccess, "export-service");

function rawStub(properties: object = {}) {
    const row = Object.create(RawReconstruction.prototype);

    Object.assign(row, {id: "raw-1", annotationId: "annotation-1"}, properties);

    row.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(row, update);
        return row;
    });

    return row;
}

const somaNode = {index: 1, parentIndex: -1, structure: 1, x: 1, y: 2, z: 3, radius: 1, lengthToParent: 0};

// A minimal SimpleReconstruction stand-in with one non-soma node per structure.
function reconstructionData() {
    const structure = (neuronStructureId: string, index: number) => ({
        soma: somaNode,
        NeuronStructureId: neuronStructureId,
        nodeCounts: {total: 2, soma: 1, path: 0, branch: 0, end: 1},
        getNonSomaNodes: () => [{index: index, parentIndex: 1, structure: 6, x: 4, y: 5, z: 6, radius: 1, lengthToParent: 1}]
    });

    return {source: "test.swc", comments: "", axon: structure("ns-axon", 2), dendrite: structure("ns-dendrite", 3)};
}

function stubEvents() {
    return vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("RawReconstruction.createFromParsed", () => {
    function stubCreate() {
        const row = rawStub({id: "raw-2"});

        vi.spyOn(NeuronStructure, "SomaNeuronStructureId", "get").mockReturnValue("ns-soma");

        return {
            row,
            create: vi.spyOn(RawReconstruction, "create").mockResolvedValue(row),
            bulkCreate: vi.spyOn(RawReconstructionNode, "bulkCreate").mockResolvedValue([]),
            createNode: vi.spyOn(RawReconstructionNode, "create").mockResolvedValue({id: "soma-2"}),
            events: stubEvents()
        };
    }

    const shape = {annotationId: "annotation-1", uploadId: "attempt-1", notes: "the notes", supersededId: "raw-1"};

    test("creates the row with the notes, an upload time and both structures' counts", async () => {
        const stubs = stubCreate();
        const data = reconstructionData();

        await RawReconstruction.createFromParsed(userWith(UserPermissions.Admin), shape, data, somaNode, transaction);

        const [values, options] = stubs.create.mock.calls[0] as any[];

        expect(values).toMatchObject({
            annotationId: "annotation-1",
            notes: "the notes",
            nodeCounts: {axon: data.axon.nodeCounts, dendrite: data.dendrite.nodeCounts}
        });
        expect(values.uploadedAt).toBeInstanceOf(Date);
        expect(options).toEqual({transaction});
    });

    test("defaults missing notes to an empty string", async () => {
        const stubs = stubCreate();

        await RawReconstruction.createFromParsed(userWith(UserPermissions.Admin), {...shape, notes: undefined}, reconstructionData(), somaNode, transaction);

        expect((stubs.create.mock.calls[0] as any[])[0].notes).toBe("");
    });

    test("keys every node on the new row and points the soma at the passed soma's node", async () => {
        const stubs = stubCreate();

        await RawReconstruction.createFromParsed(userWith(UserPermissions.Admin), shape, reconstructionData(), somaNode, transaction);

        const created = stubs.bulkCreate.mock.calls.flatMap((call: any[]) => call[0]);

        expect(created).toHaveLength(2);
        expect(created.every((node: any) => node.reconstructionId === "raw-2")).toBe(true);
        expect(stubs.bulkCreate.mock.calls.every((call: any[]) => call[1].transaction === transaction)).toBe(true);

        expect(stubs.createNode).toHaveBeenCalledWith(expect.objectContaining({index: 1, neuronStructureId: "ns-soma", reconstructionId: "raw-2"}), {transaction});
        expect(stubs.row.update).toHaveBeenCalledWith({somaNodeId: "soma-2"}, {transaction});
    });

    test("records one RawReconstructionCreate event", async () => {
        const stubs = stubCreate();

        await RawReconstruction.createFromParsed(userWith(UserPermissions.Admin), shape, reconstructionData(), somaNode, transaction);

        expect(stubs.events).toHaveBeenCalledTimes(1);
        expect(stubs.events.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.RawReconstructionCreate,
            targetId: "raw-2",
            parentId: "annotation-1",
            details: {uploadId: "attempt-1", supersededId: "raw-1"}
        });
        expect(stubs.events.mock.calls[0][1]).toEqual({transaction});
    });
});

describe("RawReconstruction.deleteForReplacement", () => {
    test("returns null and deletes nothing when there is no row", async () => {
        vi.spyOn(RawReconstruction, "findOne").mockResolvedValue(null);
        const update = vi.spyOn(RawReconstruction, "update");
        const destroyNodes = vi.spyOn(RawReconstructionNode, "destroy");
        const destroy = vi.spyOn(RawReconstruction, "destroy");

        expect(await RawReconstruction.deleteForReplacement("annotation-1", transaction)).toBeNull();

        expect(update).not.toHaveBeenCalled();
        expect(destroyNodes).not.toHaveBeenCalled();
        expect(destroy).not.toHaveBeenCalled();
    });

    // The soma foreign key is NO ACTION, so the reference has to go before the node.
    test("clears the soma, deletes the nodes, then hard-deletes the row", async () => {
        vi.spyOn(RawReconstruction, "findOne").mockResolvedValue({id: "raw-1"});
        const update = vi.spyOn(RawReconstruction, "update").mockResolvedValue([1]);
        const destroyNodes = vi.spyOn(RawReconstructionNode, "destroy").mockResolvedValue(3);
        const destroy = vi.spyOn(RawReconstruction, "destroy").mockResolvedValue(1);

        expect(await RawReconstruction.deleteForReplacement("annotation-1", transaction)).toBe("raw-1");

        expect(update).toHaveBeenCalledWith({somaNodeId: null}, {where: {id: "raw-1"}, transaction});
        expect(destroyNodes).toHaveBeenCalledWith({where: {reconstructionId: "raw-1"}, transaction});
        expect(destroy).toHaveBeenCalledWith({where: {id: "raw-1"}, force: true, transaction});

        expect(update.mock.invocationCallOrder[0]).toBeLessThan(destroyNodes.mock.invocationCallOrder[0]);
        expect(destroyNodes.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]);
    });
});

describe("RawReconstruction.discardForAnnotation", () => {
    test("does nothing when the annotation has no raw reconstruction", async () => {
        vi.spyOn(RawReconstruction, "findAll").mockResolvedValue([]);
        const update = vi.spyOn(RawReconstruction, "update");
        const destroy = vi.spyOn(RawReconstruction, "destroy");

        await RawReconstruction.discardForAnnotation("annotation-1", transaction);

        expect(update).not.toHaveBeenCalled();
        expect(destroy).not.toHaveBeenCalled();
    });

    test("clears the soma, deletes the nodes, then soft-deletes the row", async () => {
        vi.spyOn(RawReconstruction, "findAll").mockResolvedValue([{id: "raw-1"}]);
        const update = vi.spyOn(RawReconstruction, "update").mockResolvedValue([1]);
        const destroyNodes = vi.spyOn(RawReconstructionNode, "destroy").mockResolvedValue(3);
        const destroy = vi.spyOn(RawReconstruction, "destroy").mockResolvedValue(1);

        await RawReconstruction.discardForAnnotation("annotation-1", transaction);

        expect(update).toHaveBeenCalledWith({somaNodeId: null}, {where: {id: {[Op.in]: ["raw-1"]}}, transaction});
        expect(destroyNodes).toHaveBeenCalledWith({where: {reconstructionId: {[Op.in]: ["raw-1"]}}, transaction});
        expect(destroy).toHaveBeenCalledWith({where: {id: {[Op.in]: ["raw-1"]}}, transaction});
        expect((destroy.mock.calls[0][0] as any).force).toBeUndefined();

        expect(update.mock.invocationCallOrder[0]).toBeLessThan(destroyNodes.mock.invocationCallOrder[0]);
        expect(destroyNodes.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]);
    });
});

describe("RawReconstruction.copyForRevision", () => {
    const uploadedAt = new Date("2026-10-01T09:00:00Z");

    function stubCopy(source: any) {
        // The soma is index 7, so an assumption that the soma is index 1 would fail.
        const sourceNodes = [
            {id: "node-1", index: 1, toJSON: () => ({id: "node-1", index: 1, reconstructionId: "raw-1"})},
            {id: "node-7", index: 7, toJSON: () => ({id: "node-7", index: 7, reconstructionId: "raw-1"})}
        ];

        const copy = rawStub({id: "raw-2", annotationId: "annotation-2"});

        return {
            copy,
            findOne: vi.spyOn(RawReconstruction, "findOne").mockResolvedValue(source),
            create: vi.spyOn(RawReconstruction, "create").mockResolvedValue(copy),
            findNodes: vi.spyOn(RawReconstructionNode, "findAll").mockResolvedValue(sourceNodes),
            bulkCreate: vi.spyOn(RawReconstructionNode, "bulkCreate").mockResolvedValue([]),
            findNode: vi.spyOn(RawReconstructionNode, "findOne").mockResolvedValue({id: "copied-soma"}),
            events: stubEvents()
        };
    }

    test("returns null when the source has no raw reconstruction", async () => {
        const stubs = stubCopy(null);

        expect(await RawReconstruction.copyForRevision("annotation-1", "annotation-2", transaction)).toBeNull();

        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("creates the copy on the revision with the source's counts, notes and upload time", async () => {
        const stubs = stubCopy({id: "raw-1", nodeCounts: {axon: {total: 4}}, notes: "source notes", uploadedAt, somaNodeId: "node-7"});

        expect(await RawReconstruction.copyForRevision("annotation-1", "annotation-2", transaction)).toBe(stubs.copy);

        expect(stubs.findOne).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, transaction});
        expect(stubs.create).toHaveBeenCalledWith({
            annotationId: "annotation-2",
            nodeCounts: {axon: {total: 4}},
            notes: "source notes",
            uploadedAt
        }, {transaction});
    });

    test("copies the nodes with fresh ids and points the soma at the copy of the source soma's index", async () => {
        const stubs = stubCopy({id: "raw-1", nodeCounts: {}, notes: "", uploadedAt, somaNodeId: "node-7"});

        await RawReconstruction.copyForRevision("annotation-1", "annotation-2", transaction);

        expect(stubs.findNodes).toHaveBeenCalledWith({where: {reconstructionId: "raw-1"}, transaction});

        const copied = stubs.bulkCreate.mock.calls.flatMap((call: any[]) => call[0]);

        expect(copied).toEqual([
            {id: undefined, index: 1, reconstructionId: "raw-2"},
            {id: undefined, index: 7, reconstructionId: "raw-2"}
        ]);

        expect(stubs.findNode).toHaveBeenCalledWith({where: {reconstructionId: "raw-2", index: 7}, transaction});
        expect(stubs.copy.update).toHaveBeenCalledWith({somaNodeId: "copied-soma"}, {transaction});
    });

    test("records no event", async () => {
        const stubs = stubCopy({id: "raw-1", nodeCounts: {}, notes: "", uploadedAt, somaNodeId: "node-7"});

        await RawReconstruction.copyForRevision("annotation-1", "annotation-2", transaction);

        expect(stubs.events).not.toHaveBeenCalled();
    });
});

describe("RawReconstruction.toPortalFormat", () => {
    const publishedAt = new Date("2026-03-01T12:00:00Z");

    function portalUser(id: string) {
        return Object.assign(Object.create(User.prototype), {
            id, firstName: "Given", lastName: id, affiliation: "An Institute", emailAddress: `${id}@example.org`, isSystemUser: false
        });
    }

    function rawWithAnnotation(overrides: object = {}) {
        return Object.assign(Object.create(RawReconstruction.prototype), {
            id: "raw-1",
            annotationId: "annotation-1",
            Annotation: Object.assign(Object.create(Annotation.prototype), {
                id: "annotation-1",
                doi: "",
                publishedAt,
                Neuron: {toPortalFormat: () => ({id: "neuron-1", label: "N1", canonicalDoi: null, specimen: null})},
                Annotator: portalUser("annotator-1"),
                Reviewer: portalUser("peer-reviewer-1"),
                TeamReviewer: null,
                ...overrides
            })
        });
    }

    test("refuses a caller without InternalAccess", async () => {
        await expect(RawReconstruction.toPortalFormat(userWith(UserPermissions.Admin), "raw-1")).rejects.toBeInstanceOf(UnauthorizedError);
    });

    test("finds a raw id directly and emits a specimen-space reconstruction", async () => {
        vi.spyOn(RawReconstruction, "serializeNodes").mockResolvedValue([]);
        vi.spyOn(RawReconstruction, "findByPk").mockResolvedValue(rawWithAnnotation());

        const portal = await RawReconstruction.toPortalFormat(exporter, "raw-1");

        expect(portal.id).toBe("raw-1");
        expect(portal.annotationSpace).toBe(PortalAnnotationSpace.Specimen);
        expect(portal.annotator).toMatchObject({id: "annotator-1"});
        expect(portal.peerReviewer).toMatchObject({id: "peer-reviewer-1"});
        expect(portal.teamReviewer).toBeNull();
        expect(portal.doi).toBeNull();
        expect(portal.publishedAt).toBe(publishedAt);
    });

    test("emits the annotation's DOI", async () => {
        vi.spyOn(RawReconstruction, "serializeNodes").mockResolvedValue([]);
        vi.spyOn(RawReconstruction, "findByPk").mockResolvedValue(rawWithAnnotation({doi: "10.x/abc"}));

        expect((await RawReconstruction.toPortalFormat(exporter, "raw-1")).doi).toBe("10.x/abc");
    });

    test("finds an annotation id through its annotationId", async () => {
        vi.spyOn(RawReconstruction, "serializeNodes").mockResolvedValue([]);
        vi.spyOn(RawReconstruction, "findByPk").mockResolvedValue(null);
        const findOne = vi.spyOn(RawReconstruction, "findOne").mockResolvedValue(rawWithAnnotation());

        const portal = await RawReconstruction.toPortalFormat(exporter, "annotation-1");

        expect(portal.id).toBe("raw-1");
        expect((findOne.mock.calls[0][0] as any).where).toEqual({annotationId: "annotation-1"});
    });

    test("returns null for an unknown id after exactly those two lookups", async () => {
        const findByPk = vi.spyOn(RawReconstruction, "findByPk").mockResolvedValue(null);
        const findOne = vi.spyOn(RawReconstruction, "findOne").mockResolvedValue(null);

        expect(await RawReconstruction.toPortalFormat(exporter, "unknown")).toBeNull();

        expect(findByPk).toHaveBeenCalledTimes(1);
        expect(findOne).toHaveBeenCalledTimes(1);
    });

    test("eager-loads Annotator, Reviewer and TeamReviewer inside the nested Annotation include", async () => {
        vi.spyOn(RawReconstruction, "serializeNodes").mockResolvedValue([]);
        const findByPk = vi.spyOn(RawReconstruction, "findByPk").mockResolvedValue(rawWithAnnotation());

        await RawReconstruction.toPortalFormat(exporter, "raw-1");

        const includes = (findByPk.mock.calls[0][1] as any).include;
        const nested = includes.find((include: any) => include.model === Annotation);

        expect(nested.include).toEqual(expect.arrayContaining([
            {model: User, as: "Annotator"},
            {model: User, as: "Reviewer"},
            {model: User, as: "TeamReviewer"}
        ]));
    });
});

describe("RawReconstruction.serializeNodes", () => {
    test("reads the raw nodes in index order and maps the portal fields", async () => {
        vi.spyOn(NeuronStructure, "swcStructureValue").mockReturnValue(2);
        const findAll = vi.spyOn(RawReconstructionNode, "findAll").mockResolvedValue([
            {index: 1, neuronStructureId: "ns-axon", x: 1, y: 2, z: 3, radius: 0.5, parentIndex: -1}
        ]);

        const nodes = await RawReconstruction.serializeNodes(exporter, "raw-1");

        expect((findAll.mock.calls[0][0] as any).where).toEqual({reconstructionId: "raw-1"});
        expect((findAll.mock.calls[0][0] as any).order).toEqual([["index", "ASC"]]);
        expect(nodes).toEqual([{index: 1, structure: 2, x: 1, y: 2, z: 3, radius: 0.5, parentIndex: -1}]);
    });

    test("refuses a caller without InternalAccess", async () => {
        await expect(RawReconstruction.serializeNodes(userWith(UserPermissions.Admin), "raw-1")).rejects.toBeInstanceOf(UnauthorizedError);
    });
});
