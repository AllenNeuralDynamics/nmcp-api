import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {SpecimenSpaceReconstructionStatus} = require("../src/models/specimenSpaceReconstructionStatus");
const {SpecimenNode} = require("../src/models/specimenNode");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function rowStub(properties: object = {}) {
    const row = Object.create(SpecimenSpaceReconstruction.prototype);

    Object.assign(row, {id: "specimen-space-1", annotationId: "annotation-1"}, properties);

    row.update = vi.fn().mockImplementation(async (update: any) => {
        Object.assign(row, update);
        return row;
    });

    return row;
}

// A minimal SimpleReconstruction stand-in with one non-soma node per structure.
function reconstructionData() {
    const soma = {index: 1, parentIndex: -1, structure: 1, x: 1, y: 2, z: 3, radius: 1, lengthToParent: 0};

    const structure = (neuronStructureId: string, index: number) => ({
        soma: soma,
        NeuronStructureId: neuronStructureId,
        nodeCounts: {total: 2, soma: 1, path: 0, branch: 0, end: 1},
        getNonSomaNodes: () => [{index: index, parentIndex: 1, structure: 6, x: 4, y: 5, z: 6, radius: 1, lengthToParent: 1}]
    });

    return {source: "test.swc", comments: "a comment", axon: structure("ns-axon", 2), dendrite: structure("ns-dendrite", 3)};
}

function stubEvents() {
    return vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (SpecimenSpaceReconstruction as any).sequelize;
});

describe("SpecimenSpaceReconstruction.createForShape", () => {
    const shape = {status: SpecimenSpaceReconstructionStatus.Initialized, annotationId: "annotation-1"};

    test("creates the row and records one create event against the annotation", async () => {
        const created = rowStub();
        const create = vi.spyOn(SpecimenSpaceReconstruction, "create").mockResolvedValue(created);
        const events = stubEvents();

        const result = await SpecimenSpaceReconstruction.createForShape(userWith(UserPermissions.Admin), shape, transaction);

        expect(result).toBe(created);
        expect(create).toHaveBeenCalledWith(shape, {transaction: transaction});
        expect(events).toHaveBeenCalledTimes(1);
        expect(events.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.SpecimenSpaceReconstructionCreate,
            targetId: "specimen-space-1",
            parentId: "annotation-1",
            userId: "user-1"
        });
    });

    test("records the substitute user when one is given", async () => {
        vi.spyOn(SpecimenSpaceReconstruction, "create").mockResolvedValue(rowStub());
        const events = stubEvents();

        await SpecimenSpaceReconstruction.createForShape(userWith(UserPermissions.Admin), shape, transaction, userWith(UserPermissions.None, "substitute-1"));

        expect(events.mock.calls[0][0]).toMatchObject({substituteUserId: "substitute-1"});
    });

    test("opens its own transaction when given none", async () => {
        const create = vi.spyOn(SpecimenSpaceReconstruction, "create").mockResolvedValue(rowStub());
        stubEvents();

        const transactionFn = vi.fn().mockImplementation(async (callback: any) => callback(transaction));

        Object.defineProperty(SpecimenSpaceReconstruction, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});

        await SpecimenSpaceReconstruction.createForShape(userWith(UserPermissions.Admin), shape);

        expect(transactionFn).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(shape, {transaction: transaction});
    });
});

describe("SpecimenSpaceReconstruction.replaceNodeData", () => {
    function stubNodes() {
        return {
            destroy: vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0),
            bulkCreate: vi.spyOn(SpecimenNode, "bulkCreate").mockResolvedValue([]),
            create: vi.spyOn(SpecimenNode, "create").mockResolvedValue({id: "soma-1"})
        };
    }

    test("clears the soma reference before destroying the old nodes", async () => {
        const nodes = stubNodes();
        stubEvents();
        const row = rowStub();

        await row.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), transaction);

        expect(row.update.mock.calls[0]).toEqual([{somaNodeId: null}, {transaction: transaction}]);
        expect(nodes.destroy).toHaveBeenCalledWith({where: {reconstructionId: "specimen-space-1"}, transaction: transaction});
        expect(row.update.mock.invocationCallOrder[0]).toBeLessThan(nodes.destroy.mock.invocationCallOrder[0]);
    });

    test("keys every new node and the soma on this row", async () => {
        const nodes = stubNodes();
        stubEvents();
        const row = rowStub();

        await row.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), transaction);

        const created = nodes.bulkCreate.mock.calls.flatMap((call: any[]) => call[0]);

        expect(created).toHaveLength(2);
        expect(created.every((node: any) => node.reconstructionId === "specimen-space-1")).toBe(true);
        expect(nodes.create.mock.calls[0][0]).toMatchObject({reconstructionId: "specimen-space-1", index: 1});
    });

    test("writes the source, the counts and the new soma", async () => {
        stubNodes();
        stubEvents();
        const row = rowStub();
        const data = reconstructionData();

        await row.replaceNodeData(userWith(UserPermissions.Admin), data, transaction);

        expect(row.update.mock.calls[1]).toEqual([{
            sourceUrl: "test.swc",
            sourceComments: "a comment",
            nodeCounts: {axon: data.axon.nodeCounts, dendrite: data.dendrite.nodeCounts},
            somaNodeId: "soma-1"
        }, {transaction: transaction}]);
    });

    test("records one specimen-space upload event and no legacy upload", async () => {
        stubNodes();
        const events = stubEvents();
        const row = rowStub();

        await row.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), transaction);

        expect(events).toHaveBeenCalledTimes(1);
        expect(events.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.SpecimenSpaceReconstructionUpload,
            targetId: "specimen-space-1",
            parentId: "annotation-1"
        });
        expect((events.mock.calls[0][0] as any).kind).not.toBe(EventLogItemKind.ReconstructionUpload);
    });
});

describe("SpecimenSpaceReconstruction.copyFrom", () => {
    function stubCopy() {
        const sourceNodes = [
            {toJSON: () => ({id: "node-1", index: 1, reconstructionId: "specimen-space-source"})},
            {toJSON: () => ({id: "node-2", index: 2, reconstructionId: "specimen-space-source"})}
        ];

        const requestGeneration = vi.fn().mockResolvedValue(undefined);

        return {
            findAll: vi.spyOn(SpecimenNode, "findAll").mockResolvedValue(sourceNodes),
            bulkCreate: vi.spyOn(SpecimenNode, "bulkCreate").mockResolvedValue([]),
            findOne: vi.spyOn(SpecimenNode, "findOne").mockResolvedValue({id: "copied-soma-1"}),
            createPrecomputed: vi.spyOn(SpecimenSpacePrecomputed, "createForReconstruction").mockResolvedValue({requestGeneration: requestGeneration}),
            requestGeneration: requestGeneration,
            events: stubEvents()
        };
    }

    const source = {
        id: "specimen-space-source",
        sourceUrl: "source.swc",
        sourceComments: "from the source",
        lengthMillimeters: 12.5,
        nodeCounts: {axon: {total: 4}, dendrite: {total: 3}}
    };

    test("copies the source's nodes onto this row with fresh ids", async () => {
        const stubs = stubCopy();
        const row = rowStub({id: "specimen-space-2", annotationId: "annotation-2"});

        await row.copyFrom(source, userWith(UserPermissions.Admin), transaction);

        expect(stubs.findAll).toHaveBeenCalledWith({where: {reconstructionId: "specimen-space-source"}, transaction: transaction});

        const copied = stubs.bulkCreate.mock.calls.flatMap((call: any[]) => call[0]);

        expect(copied).toEqual([
            {id: undefined, index: 1, reconstructionId: "specimen-space-2"},
            {id: undefined, index: 2, reconstructionId: "specimen-space-2"}
        ]);
    });

    test("copies the data columns and points the soma at the copied index-1 node", async () => {
        const stubs = stubCopy();
        const row = rowStub({id: "specimen-space-2", annotationId: "annotation-2"});

        await row.copyFrom(source, userWith(UserPermissions.Admin), transaction);

        expect(stubs.findOne).toHaveBeenCalledWith({where: {reconstructionId: "specimen-space-2", index: 1}, transaction: transaction});
        expect(row.update).toHaveBeenCalledWith({
            sourceUrl: "source.swc",
            sourceComments: "from the source",
            lengthMillimeters: 12.5,
            nodeCounts: {axon: {total: 4}, dendrite: {total: 3}},
            somaNodeId: "copied-soma-1"
        }, {transaction: transaction});
    });

    test("creates this row's precomputed entry, requests generation, and records no event", async () => {
        const stubs = stubCopy();
        const user = userWith(UserPermissions.Admin);
        const row = rowStub({id: "specimen-space-2", annotationId: "annotation-2"});

        await row.copyFrom(source, user, transaction);

        expect(stubs.createPrecomputed).toHaveBeenCalledWith(user, "specimen-space-2", transaction);
        expect(stubs.requestGeneration).toHaveBeenCalledWith(user, transaction);
        expect(stubs.events).not.toHaveBeenCalled();
    });
});

describe("SpecimenSpaceReconstruction.discardForAnnotation", () => {
    test("destroys the rows' nodes, then soft-deletes the rows, on the passed transaction", async () => {
        const findAll = vi.spyOn(SpecimenSpaceReconstruction, "findAll").mockResolvedValue([{id: "specimen-space-1"}]);
        const destroyNodes = vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(3);
        const destroyRows = vi.spyOn(SpecimenSpaceReconstruction, "destroy").mockResolvedValue(1);

        await SpecimenSpaceReconstruction.discardForAnnotation("annotation-1", transaction);

        expect(findAll).toHaveBeenCalledWith({where: {annotationId: "annotation-1"}, attributes: ["id"], transaction: transaction});
        expect(destroyNodes).toHaveBeenCalledWith({where: {reconstructionId: {[Op.in]: ["specimen-space-1"]}}, transaction: transaction});
        expect(destroyRows).toHaveBeenCalledWith({where: {id: {[Op.in]: ["specimen-space-1"]}}, transaction: transaction});
        expect(destroyNodes.mock.invocationCallOrder[0]).toBeLessThan(destroyRows.mock.invocationCallOrder[0]);
    });

    test("destroys nothing when the annotation has no row", async () => {
        vi.spyOn(SpecimenSpaceReconstruction, "findAll").mockResolvedValue([]);
        const destroyNodes = vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0);
        const destroyRows = vi.spyOn(SpecimenSpaceReconstruction, "destroy").mockResolvedValue(0);

        await SpecimenSpaceReconstruction.discardForAnnotation("annotation-1", transaction);

        expect(destroyNodes).not.toHaveBeenCalled();
        expect(destroyRows).not.toHaveBeenCalled();
    });
});
