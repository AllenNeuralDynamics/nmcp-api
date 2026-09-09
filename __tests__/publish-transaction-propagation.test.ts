import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {Neuron} = require("../src/models/neuron");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {QualityControl} = require("../src/models/qualityControl");
const {Precomputed} = require("../src/models/precomputed");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {SpecimenNode} = require("../src/models/specimenNode");
const {AtlasNode} = require("../src/models/atlasNode");
const {SearchIndex} = require("../src/models/searchIndex");
const {Atlas} = require("../src/models/atlas");
const {EventLogItem} = require("../src/models/eventLogItem");
const {QualityCheckService, QualityCheckServiceStatus, QualityControlScore} = require("../src/data-access/qualityCheckService");

// A sentinel rather than a real Transaction: every assertion here is that this exact value reaches the read.
const transaction = {sentinel: "t"} as any;

const carriesTransaction = expect.objectContaining({transaction: transaction});

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

// Instances are built straight off the prototype so the methods under test can be called directly.  Several are
// private or protected in TypeScript but ordinary prototype methods in the compiled JS, which is what lets a test
// reach publishWithTransaction without going through publish's guards.
function prototypeStub(model: any, properties: object = {}) {
    const instance = Object.create(model.prototype);
    Object.assign(instance, {id: "instance-1"}, properties);
    instance.update = updateMock(instance);
    return instance;
}

// The callback form of transaction() hands the sentinel to methods that open their own.
function defineSequelize(model: any) {
    Object.defineProperty(model, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });
}

function stubEvents() {
    return vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
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

    return {
        source: "test.swc",
        comments: "",
        axon: structure("ns-axon"),
        dendrite: structure("ns-dendrite")
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
    delete (AtlasReconstruction as any).sequelize;
    delete (QualityControl as any).sequelize;
    Atlas.defaultAtlas = null;
});

describe("approveReconstruction", () => {
    test("loads the atlas reconstruction through the transaction", async () => {
        stubEvents();
        defineSequelize(Reconstruction);

        const atlasReconstruction = {approve: vi.fn().mockResolvedValue(false)};

        const reconstruction = prototypeStub(Reconstruction, {
            neuronId: "neuron-1",
            status: ReconstructionStatus.PublishReview,
            getAtlasReconstruction: vi.fn().mockResolvedValue(atlasReconstruction)
        });

        vi.spyOn(Reconstruction, "findByPk").mockResolvedValue(reconstruction);
        vi.spyOn(User, "findUserOrId").mockResolvedValue(userWith(UserPermissions.Admin));

        await Reconstruction.approveReconstruction("r1", ReconstructionStatus.Approved, "u1");

        expect(reconstruction.getAtlasReconstruction).toHaveBeenCalledWith({transaction: transaction});
    });
});

describe("publishWithTransaction", () => {
    function publishable(existingPublished: any) {
        stubEvents();

        // The sibling read is a findAll over the blocking statuses, and the neuron row is locked before it.
        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue(existingPublished ? [existingPublished] : []);

        // Publish asserts both DOIs rather than assigning them, and reads the canonical off the locked neuron row.
        vi.spyOn(Neuron, "findByPk").mockResolvedValue({id: "neuron-1", canonicalDoi: "10.x/canonical"} as any);

        const reconstruction = prototypeStub(Reconstruction, {
            neuronId: "neuron-1",
            status: ReconstructionStatus.ReadyToPublish,
            AtlasReconstruction: {nodeCounts: {}, doi: "10.x/abc", tryStartPublishing: vi.fn().mockResolvedValue(true)}
        });

        return {reconstruction: reconstruction, findAll: findAll};
    }

    test("looks for sibling rows through the transaction", async () => {
        const stubs = publishable(null);

        await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), true, transaction);

        expect(stubs.findAll).toHaveBeenCalledWith(carriesTransaction);
    });

    test("archivePublished reads and deletes through the transaction", async () => {
        const atlasReconstruction = {id: "atlas-old"};

        const existingPublished = prototypeStub(Reconstruction, {
            id: "reconstruction-old",
            neuronId: "neuron-1",
            status: ReconstructionStatus.Published,
            getAtlasReconstruction: vi.fn().mockResolvedValue(atlasReconstruction)
        });

        const stubs = publishable(existingPublished);

        const destroy = vi.spyOn(SearchIndex, "destroy").mockResolvedValue(0);

        await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), true, transaction);

        expect(stubs.findAll).toHaveBeenCalledWith(carriesTransaction);
        expect(existingPublished.getAtlasReconstruction).toHaveBeenCalledWith({transaction: transaction});
        expect(destroy).toHaveBeenCalledWith(carriesTransaction);
    });
});

describe("prepareToFinalize", () => {
    test("both finders read through the transaction", async () => {
        stubEvents();

        const findQualityControl = vi.spyOn(QualityControl, "findOne")
            .mockResolvedValue({makePending: vi.fn().mockResolvedValue(undefined)} as any);

        const findPrecomputed = vi.spyOn(Precomputed, "findOne").mockResolvedValue({id: "precomputed-1"} as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            reconstructionId: "reconstruction-1",
            nodeCounts: {}
        });

        await atlasReconstruction.prepareToFinalize(userWith(UserPermissions.Admin), transaction);

        expect(findQualityControl).toHaveBeenCalledWith(carriesTransaction);
        expect(findPrecomputed).toHaveBeenCalledWith(carriesTransaction);
    });
});

describe("calculateStructureAssignments", () => {
    function assignable(nodeCount: number) {
        stubEvents();
        defineSequelize(AtlasReconstruction);

        vi.spyOn(Atlas, "getAtlas").mockReturnValue({
            findForLocation: vi.fn().mockReturnValue("structure-1")
        } as any);

        const precomputed = {requestGeneration: vi.fn().mockResolvedValue(undefined)};

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            reconstructionId: "reconstruction-1",
            status: AtlasReconstructionStatus.PendingStructureAssignment,
            getReconstruction: vi.fn().mockResolvedValue({Neuron: {Specimen: {atlasId: "atlas-1"}}}),
            getPrecomputed: vi.fn().mockResolvedValue(precomputed)
        });

        return {
            atlasReconstruction: atlasReconstruction,
            count: vi.spyOn(AtlasNode, "count").mockResolvedValue(nodeCount),
            findAll: vi.spyOn(AtlasNode, "findAll").mockResolvedValue([{id: "node-1", x: 1, y: 2, z: 3}] as any),
            updateNodes: vi.spyOn(AtlasNode, "update").mockResolvedValue([1] as any)
        };
    }

    test("loads the precomputed row through the transaction", async () => {
        const stubs = assignable(0);

        await stubs.atlasReconstruction.calculateStructureAssignments(userWith(UserPermissions.Admin));

        expect(stubs.atlasReconstruction.getPrecomputed).toHaveBeenCalledWith({transaction: transaction});
    });

    test("reads each node chunk through the transaction", async () => {
        const stubs = assignable(1);

        await stubs.atlasReconstruction.calculateStructureAssignments(userWith(UserPermissions.Admin));

        expect(stubs.findAll).toHaveBeenCalledTimes(1);
        expect(stubs.findAll).toHaveBeenCalledWith(carriesTransaction);
    });
});

describe("AtlasReconstruction.precomputedChanged", () => {
    // The parent is not notified here any more - it stays WaitingForAtlasReconstruction until DOI assignment
    // completes, and assignDois makes that call itself.
    test("writes the status update through the transaction and does not load the parent", async () => {
        stubEvents();

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            reconstructionId: "reconstruction-1",
            status: AtlasReconstructionStatus.PendingPrecomputed,
            getReconstruction: vi.fn().mockResolvedValue({onAtlasReconstructionStatusChanged: vi.fn().mockResolvedValue(undefined)})
        });

        await atlasReconstruction.precomputedChanged(userWith(UserPermissions.Admin), true, transaction);

        expect(atlasReconstruction.update).toHaveBeenCalledWith(
            {status: AtlasReconstructionStatus.PendingDoiAssignment},
            {transaction: transaction}
        );

        expect(atlasReconstruction.getReconstruction).not.toHaveBeenCalled();
    });
});

describe("QualityControl.assess", () => {
    test("loads the atlas reconstruction through its own transaction", async () => {
        stubEvents();
        defineSequelize(QualityControl);

        vi.spyOn(QualityCheckService, "performQualityCheck").mockResolvedValue({
            serviceStatus: QualityCheckServiceStatus.Success,
            output: {score: QualityControlScore.Passed}
        } as any);

        const qualityControl = prototypeStub(QualityControl, {
            reconstructionId: "atlas-1",
            getReconstruction: vi.fn().mockResolvedValue({qualityControlChanged: vi.fn().mockResolvedValue(undefined)})
        });

        await qualityControl.assess(userWith(UserPermissions.Admin));

        expect(qualityControl.getReconstruction).toHaveBeenCalledWith({transaction: transaction});
    });
});

describe("Precomputed.precomputedChanged", () => {
    test("loads the atlas reconstruction through the transaction", async () => {
        const precomputed = prototypeStub(Precomputed, {
            reconstructionId: "atlas-1",
            getReconstruction: vi.fn().mockResolvedValue({precomputedChanged: vi.fn().mockResolvedValue(undefined)})
        });

        await precomputed.precomputedChanged(userWith(UserPermissions.Admin), true, transaction);

        expect(precomputed.getReconstruction).toHaveBeenCalledWith({transaction: transaction});
    });
});

describe("discardForReconstruction", () => {
    test("selects the child rows through the transaction", async () => {
        const findAll = vi.spyOn(AtlasReconstruction, "findAll").mockResolvedValue([] as any);

        await AtlasReconstruction.discardForReconstruction(userWith(UserPermissions.Admin), "r1", transaction);

        expect(findAll).toHaveBeenCalledWith(carriesTransaction);
    });
});

describe("fromParsedStructures", () => {
    test("the specimen branch reads the precomputed row through the transaction", async () => {
        stubEvents();
        defineSequelize(Reconstruction);

        vi.spyOn(Reconstruction.prototype as any, "replaceNodeData").mockResolvedValue(undefined);

        const findOne = vi.spyOn(SpecimenSpacePrecomputed, "findOne")
            .mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)} as any);

        const reconstruction = prototypeStub(Reconstruction, {
            neuronId: "neuron-1",
            status: ReconstructionStatus.PublishReview
        });

        await reconstruction.fromParsedStructures(userWith(UserPermissions.Admin), ReconstructionSpace.Specimen, reconstructionData());

        expect(findOne).toHaveBeenCalledWith(carriesTransaction);
    });

    test("the atlas branch loads the child through the transaction", async () => {
        stubEvents();
        defineSequelize(Reconstruction);

        const atlasReconstruction = {replaceNodeData: vi.fn().mockResolvedValue(undefined)};

        const reconstruction = prototypeStub(Reconstruction, {
            neuronId: "neuron-1",
            status: ReconstructionStatus.PublishReview,
            getAtlasReconstruction: vi.fn().mockResolvedValue(atlasReconstruction),
            // atlasSoma is already populated, so the soma back-fill branch is skipped.
            getNeuron: vi.fn().mockResolvedValue({atlasSoma: {x: 1, y: 2, z: 3}})
        });

        await reconstruction.fromParsedStructures(userWith(UserPermissions.Admin), ReconstructionSpace.Atlas, reconstructionData());

        expect(reconstruction.getAtlasReconstruction).toHaveBeenCalledWith({transaction: transaction});
    });
});

describe("replaceNodeData", () => {
    test("Reconstruction clears the soma reference inside the transaction", async () => {
        stubEvents();

        vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0);
        vi.spyOn(SpecimenNode, "bulkCreate").mockResolvedValue([] as any);
        vi.spyOn(SpecimenNode, "create").mockResolvedValue({id: "soma-1"} as any);

        const reconstruction = prototypeStub(Reconstruction, {neuronId: "neuron-1"});

        await reconstruction.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), transaction);

        expect(reconstruction.update.mock.calls[0]).toEqual([{specimenSomaNodeId: null}, {transaction: transaction}]);
    });

    test("AtlasReconstruction clears the soma reference inside the transaction", async () => {
        stubEvents();

        // mapToAtlasNodeShape resolves the soma's atlas structure through the default atlas, which is null until a
        // cache load that never happens in tests.
        Atlas.defaultAtlas = {getFromStructureId: () => null};

        vi.spyOn(AtlasNode, "destroy").mockResolvedValue(0);
        vi.spyOn(AtlasNode, "bulkCreate").mockResolvedValue([] as any);
        vi.spyOn(AtlasNode, "create").mockResolvedValue({id: "soma-1"} as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {reconstructionId: "reconstruction-1"});

        await atlasReconstruction.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), transaction);

        expect(atlasReconstruction.update.mock.calls[0]).toEqual([{somaNodeId: null}, {transaction: transaction}]);
    });
});
