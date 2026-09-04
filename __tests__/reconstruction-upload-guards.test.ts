import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {Neuron} = require("../src/models/neuron");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {QualityControl} = require("../src/models/qualityControl");
const {Precomputed} = require("../src/models/precomputed");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function updateMock(instance: any) {
    return vi.fn().mockImplementation(async (update: any) => {
        Object.assign(instance, update);
        return instance;
    });
}

// A minimal SimpleReconstruction stand-in.  Both replaceNodeData implementations need a soma and two structures.
function reconstructionData() {
    const soma = {index: 1, parentIndex: -1, structure: 1, x: 1, y: 2, z: 3, radius: 1, lengthToParent: 0};

    const structure = (neuronStructureId: string) => ({
        soma: soma,
        NeuronStructureId: neuronStructureId,
        nodeCounts: {total: 1, soma: 1, path: 0, branch: 0, end: 0},
        getNonSomaNodes: () => []
    });

    return {source: "test.swc", comments: "", axon: structure("ns-axon"), dendrite: structure("ns-dendrite")};
}

function defineSequelize(model: any) {
    Object.defineProperty(model, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });
}

/**
 * The instance the upload was loaded on and the instance it re-reads under the lock are the same object here: the
 * interleavings where they differ are transition-serialization.test.ts.
 */
function reconstructionStub(status: number) {
    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.status = status;
    reconstruction.update = updateMock(reconstruction);

    vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);

    return reconstruction;
}

function atlasStub() {
    return {
        id: "atlas-1",
        replaceNodeData: vi.fn().mockResolvedValue(undefined),
        prepareToFinalize: vi.fn().mockResolvedValue(undefined),
        approve: vi.fn().mockResolvedValue(undefined),
        getSoma: vi.fn().mockResolvedValue({x: 4, y: 5, z: 6})
    };
}

const allStatuses = Object.keys(ReconstructionStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => ReconstructionStatus[key] as number);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("fromParsedStructures in specimen space", () => {
    function specimenStubs(status: number) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        defineSequelize(Reconstruction);

        vi.spyOn(Reconstruction.prototype as any, "replaceNodeData").mockResolvedValue(undefined);
        vi.spyOn(SpecimenSpacePrecomputed, "findOne")
            .mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)} as any);

        const neuron = vi.spyOn(Neuron, "findByPk").mockResolvedValue({atlasSoma: {x: 1, y: 2, z: 3}} as any);

        return {reconstruction: reconstructionStub(status), neuron: neuron};
    }

    test.each([ReconstructionStatus.PeerReview, ReconstructionStatus.PublishReview])("accepts %s", async (status: number) => {
        const stubs = specimenStubs(status);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PeerReview | UserPermissions.PublishReview), ReconstructionSpace.Specimen, reconstructionData());

        expect((Reconstruction.prototype as any).replaceNodeData).toHaveBeenCalledTimes(1);
    });

    // The admin bypass does not reach these: a status absent from UploadSourceStatuses is not an upload source at all,
    // for anyone, and this is the locked check rather than the permission in any case.
    test.each(allStatuses.filter(status => status !== ReconstructionStatus.PeerReview && status !== ReconstructionStatus.PublishReview))(
        "refuses %s even for an admin",
        async (status: number) => {
            const stubs = specimenStubs(status);

            await expect(stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.Admin), ReconstructionSpace.Specimen, reconstructionData()))
                .rejects.toThrow(/not in peer or publish review/);

            expect((Reconstruction.prototype as any).replaceNodeData).not.toHaveBeenCalled();
        });

    // This branch writes no neuron, so it stays out of the Neuron -> AtlasReconstruction -> Reconstruction order and
    // takes the parent alone.
    test("locks the parent and neither the child nor the neuron", async () => {
        const stubs = specimenStubs(ReconstructionStatus.PublishReview);
        const findAtlas = vi.spyOn(AtlasReconstruction, "findOne");

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Specimen, reconstructionData());

        expect(Reconstruction.findByPk).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
        expect(findAtlas).not.toHaveBeenCalled();
        expect(stubs.neuron).not.toHaveBeenCalled();
    });

    // The permission is re-evaluated against the locked status, so the reviewer who may write depends on where the
    // reconstruction actually is, not on where it was when the file started parsing.
    test("refuses a peer reviewer at PublishReview", async () => {
        const stubs = specimenStubs(ReconstructionStatus.PublishReview);

        await expect(stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PeerReview), ReconstructionSpace.Specimen, reconstructionData()))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect((Reconstruction.prototype as any).replaceNodeData).not.toHaveBeenCalled();
    });

    test("disregardAuth skips the permission but not the status", async () => {
        const accepted = specimenStubs(ReconstructionStatus.PublishReview);

        await accepted.reconstruction.fromParsedStructures(userWith(UserPermissions.None), ReconstructionSpace.Specimen, reconstructionData(), null, true);

        expect((Reconstruction.prototype as any).replaceNodeData).toHaveBeenCalledTimes(1);

        const refused = specimenStubs(ReconstructionStatus.Approved);

        await expect(refused.reconstruction.fromParsedStructures(userWith(UserPermissions.None), ReconstructionSpace.Specimen, reconstructionData(), null, true))
            .rejects.toThrow(/not in peer or publish review/);
    });
});

describe("fromParsedStructures in atlas space", () => {
    function atlasStubs(status: number, options: {atlasSoma?: object} = {}) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        defineSequelize(Reconstruction);

        const atlasReconstruction = atlasStub();

        const neuron = {
            atlasSoma: "atlasSoma" in options ? options.atlasSoma : {x: 1, y: 2, z: 3},
            update: vi.fn().mockResolvedValue(undefined)
        };

        return {
            reconstruction: reconstructionStub(status),
            atlasReconstruction: atlasReconstruction,
            neuron: neuron,
            findAtlas: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any),
            findNeuron: vi.spyOn(Neuron, "findByPk").mockResolvedValue(neuron as any)
        };
    }

    test("accepts PublishReview", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.atlasReconstruction.replaceNodeData).toHaveBeenCalledTimes(1);
    });

    // Approved is gone as a source with the deferred upload: an approval now requires the data, so an upload arriving
    // after one has committed is a lost race rather than a deferred step.
    test.each(allStatuses.filter(status => status !== ReconstructionStatus.PublishReview))(
        "refuses %s",
        async (status: number) => {
            const stubs = atlasStubs(status);

            await expect(stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.Admin), ReconstructionSpace.Atlas, reconstructionData()))
                .rejects.toThrow(/not in publish review/);

            expect(stubs.atlasReconstruction.replaceNodeData).not.toHaveBeenCalled();
        });

    test("never finalizes or advances the parent", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.atlasReconstruction.prepareToFinalize).not.toHaveBeenCalled();
        expect(stubs.atlasReconstruction.approve).not.toHaveBeenCalled();
        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.PublishReview);
    });

    test("throws when the reconstruction has no atlas child", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);
        stubs.findAtlas.mockResolvedValue(null);

        await expect(stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData()))
            .rejects.toThrow(/Atlas reconstruction for reconstruction-1 not found/);
    });

    /**
     * The back-fill updates the neuron, so this transaction takes that row's write lock either way.  Taking it first is
     * what keeps the upload on publish's order - a publish holding the neuron and waiting on the child would otherwise
     * deadlock against an upload holding the child and waiting on the neuron.
     */
    test("locks Neuron, then the child, then the parent", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.findNeuron).toHaveBeenCalledWith("neuron-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
        expect(stubs.findAtlas).toHaveBeenCalledWith({
            where: {reconstructionId: "reconstruction-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });
        expect(Reconstruction.findByPk).toHaveBeenCalledWith("reconstruction-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});

        expect(stubs.findNeuron.mock.invocationCallOrder[0]).toBeLessThan(stubs.findAtlas.mock.invocationCallOrder[0]);
        expect(stubs.findAtlas.mock.invocationCallOrder[0]).toBeLessThan((Reconstruction.findByPk as any).mock.invocationCallOrder[0]);
    });

    // atlasSoma defaults to the origin, so this is the common path rather than a corner of one.
    test("back-fills the atlas soma onto the locked neuron when it is unset", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview, {atlasSoma: {x: 0, y: 0, z: 0}});

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.neuron.update).toHaveBeenCalledWith({atlasSoma: {x: 4, y: 5, z: 6}}, {transaction: transaction});
    });

    test("leaves a populated atlas soma alone", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.neuron.update).not.toHaveBeenCalled();
    });

    test("refuses a caller holding neither Admin nor PublishReview", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);

        await expect(stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PeerReview), ReconstructionSpace.Atlas, reconstructionData()))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.atlasReconstruction.replaceNodeData).not.toHaveBeenCalled();
    });

    // What fromSwcFile and fromParquetFile pass: an imported proofreader holds no portal review permissions, and the
    // status rule still applies to them.
    test("disregardAuth skips the permission but not the status", async () => {
        const accepted = atlasStubs(ReconstructionStatus.PublishReview);

        await accepted.reconstruction.fromParsedStructures(userWith(UserPermissions.None), ReconstructionSpace.Atlas, reconstructionData(), null, true);

        expect(accepted.atlasReconstruction.replaceNodeData).toHaveBeenCalledTimes(1);

        const refused = atlasStubs(ReconstructionStatus.WaitingForAtlasReconstruction);

        await expect(refused.reconstruction.fromParsedStructures(userWith(UserPermissions.None), ReconstructionSpace.Atlas, reconstructionData(), null, true))
            .rejects.toThrow(/not in publish review/);

        expect(refused.atlasReconstruction.replaceNodeData).not.toHaveBeenCalled();
    });
});

describe("AtlasReconstruction.approve", () => {
    // The reviewer is still recorded here because it is a fact about the approval and is what the DOI phase credits.
    // Whether the pipeline can start is no longer a question it answers - the caller has already required the data.
    test("records the reviewer and the event, and starts the automatic phases", async () => {
        const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        vi.spyOn(QualityControl, "findOne").mockResolvedValue(null);
        vi.spyOn(QualityControl, "createForReconstruction").mockResolvedValue({id: "qc-1"} as any);
        vi.spyOn(Precomputed, "findOne").mockResolvedValue({id: "precomputed-1"} as any);

        const atlasReconstruction = Object.create(AtlasReconstruction.prototype);
        atlasReconstruction.id = "atlas-1";
        atlasReconstruction.reconstructionId = "reconstruction-1";
        atlasReconstruction.nodeCounts = {};
        atlasReconstruction.update = updateMock(atlasReconstruction);

        const result = await atlasReconstruction.approve(userWith(UserPermissions.PublishReview, "approver-1"), transaction);

        expect(result).toBeUndefined();
        expect(atlasReconstruction.reviewerId).toBe("approver-1");
        expect(atlasReconstruction.status).toBe(require("../src/models/atlasReconstructionStatus").AtlasReconstructionStatus.PendingQualityControl);
        expect(create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.AtlasReconstructionApprove});
    });
});
