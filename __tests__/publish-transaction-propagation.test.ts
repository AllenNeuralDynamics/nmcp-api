import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Annotation} = require("../src/models/annotation");
const {Neuron} = require("../src/models/neuron");
const {AnnotationStatus} = require("../src/models/annotationStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {AtlasQualityControl} = require("../src/models/atlasQualityControl");
const {Precomputed, PrecomputedStatus} = require("../src/models/precomputed");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {SpecimenNode} = require("../src/models/specimenNode");
const {AtlasNode} = require("../src/models/atlasNode");
const {SearchIndex} = require("../src/models/searchIndex");
const {Atlas} = require("../src/models/atlas");
const {Specimen} = require("../src/models/specimen");
const {EventLogItem} = require("../src/models/eventLogItem");
const {QualityCheckService, QualityCheckServiceStatus, toQualityControlOutput} = require("../src/data-access/qualityCheckService");
const {AtlasQualityControlStatus} = require("../src/models/atlasQualityControlStatus");

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
    delete (Annotation as any).sequelize;
    delete (AtlasReconstruction as any).sequelize;
    delete (AtlasQualityControl as any).sequelize;
});

describe("approveAnnotation", () => {
    test("locks the atlas reconstruction through the transaction", async () => {
        stubEvents();
        defineSequelize(Annotation);

        const atlasReconstruction = {nodeCounts: {}, approve: vi.fn().mockResolvedValue(undefined)};

        const reconstruction = prototypeStub(Annotation, {
            neuronId: "neuron-1",
            status: AnnotationStatus.PublishReview
        });

        const findAtlas = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any);

        vi.spyOn(Annotation, "findByPk").mockResolvedValue(reconstruction);
        vi.spyOn(User, "findUserOrId").mockResolvedValue(userWith(UserPermissions.Admin));

        await Annotation.approveAnnotation("r1", AnnotationStatus.Approved, "u1");

        expect(findAtlas).toHaveBeenCalledWith({
            where: {annotationId: "instance-1"},
            lock: Transaction.LOCK.UPDATE,
            transaction: transaction
        });

        expect((Annotation.findByPk as any)).toHaveBeenCalledWith("instance-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
    });
});

describe("publishWithTransaction", () => {
    function publishable(existingPublished: any) {
        stubEvents();

        // The sibling read is a findAll over the blocking statuses, and the neuron row is locked before it.
        const findAll = vi.spyOn(Annotation, "findAll").mockResolvedValue(existingPublished ? [existingPublished] : []);

        // Publish asserts both DOIs rather than assigning them, and reads the canonical off the locked neuron row.
        vi.spyOn(Neuron, "findByPk").mockResolvedValue({id: "neuron-1", canonicalDoi: "10.x/canonical"} as any);

        const atlasReconstruction = {nodeCounts: {}, tryStartPublishing: vi.fn().mockResolvedValue(true)};

        const reconstruction = prototypeStub(Annotation, {
            neuronId: "neuron-1",
            status: AnnotationStatus.ReadyToPublish,
            doi: "10.x/abc",
            AtlasReconstruction: atlasReconstruction
        });

        // Both rows are re-read under lock inside the transaction and it is those instances the decision is made on.
        vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any);
        vi.spyOn(Annotation, "findByPk").mockResolvedValue(reconstruction);

        return {reconstruction: reconstruction, findAll: findAll};
    }

    test("looks for sibling rows through the transaction", async () => {
        const stubs = publishable(null);

        await stubs.reconstruction.publishWithTransaction(userWith(UserPermissions.Admin), true, transaction);

        expect(stubs.findAll).toHaveBeenCalledWith(carriesTransaction);
    });

    test("archivePublished reads and deletes through the transaction", async () => {
        const atlasReconstruction = {id: "atlas-old"};

        const existingPublished = prototypeStub(Annotation, {
            id: "annotation-old",
            neuronId: "neuron-1",
            status: AnnotationStatus.Published,
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

        const findQualityControl = vi.spyOn(AtlasQualityControl, "findOne")
            .mockResolvedValue({makePending: vi.fn().mockResolvedValue(undefined)} as any);

        const findPrecomputed = vi.spyOn(Precomputed, "findOne").mockResolvedValue({id: "precomputed-1"} as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            annotationId: "annotation-1",
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
            spatialUrl: "volume.nrrd",
            findForLocation: vi.fn().mockReturnValue("structure-1")
        } as any);

        const precomputed = {requestGeneration: vi.fn().mockResolvedValue(undefined)};

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {
            annotationId: "annotation-1",
            status: AtlasReconstructionStatus.PendingStructureAssignment,
            getAnnotation: vi.fn().mockResolvedValue({Neuron: {Specimen: {atlasId: "atlas-1"}}}),
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
            annotationId: "annotation-1",
            status: AtlasReconstructionStatus.PendingPrecomputed,
            getAnnotation: vi.fn().mockResolvedValue({onAtlasReconstructionStatusChanged: vi.fn().mockResolvedValue(undefined)})
        });

        await atlasReconstruction.precomputedChanged(userWith(UserPermissions.Admin), PrecomputedStatus.Complete, transaction);

        expect(atlasReconstruction.update).toHaveBeenCalledWith(
            {status: AtlasReconstructionStatus.PendingDoiAssignment, failureReason: null, failedAt: null},
            {transaction: transaction}
        );

        expect(atlasReconstruction.getAnnotation).not.toHaveBeenCalled();
    });
});

describe("AtlasQualityControl.assess", () => {
    // Through a locked findByPk rather than getAnnotation: the child lock has to be taken before this row is
    // written, so that a claim and a reassessment cannot deadlock against each other.
    test("locks the atlas reconstruction through its own transaction", async () => {
        stubEvents();
        defineSequelize(AtlasQualityControl);

        // Unstubbed, serialization would throw and send assess down its failure path instead of the success path.
        vi.spyOn(AtlasReconstruction, "serializeNodes").mockResolvedValue([]);

        vi.spyOn(QualityCheckService, "performQualityCheck").mockResolvedValue({
            reconstructionId: "atlas-1",
            serviceStatus: QualityCheckServiceStatus.Success,
            serviceError: null,
            output: toQualityControlOutput("atlas-1", {
                serviceVersion: "3.0.3",
                standardMorphVersion: "1.0.3",
                reconstructionId: "atlas-1",
                qualityControl: {metrics: [{name: "non_empty", status_history: [{status: "Pass"}]}]},
                error: null
            })
        } as any);

        const child = {qualityControlChanged: vi.fn().mockResolvedValue(undefined)};

        const lockChild = vi.spyOn(AtlasReconstruction, "findByPk").mockResolvedValue(child as any);

        const qualityControl = prototypeStub(AtlasQualityControl, {reconstructionId: "atlas-1"});

        await qualityControl.assess(userWith(UserPermissions.Admin));

        expect(lockChild).toHaveBeenCalledWith("atlas-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
        expect(child.qualityControlChanged).toHaveBeenCalledWith(AtlasQualityControlStatus.Passed, null, expect.anything(), transaction);
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

describe("discardForAnnotation", () => {
    test("selects the child row through the transaction", async () => {
        const findOne = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(null);

        await AtlasReconstruction.discardForAnnotation(userWith(UserPermissions.Admin), "r1", transaction);

        expect(findOne).toHaveBeenCalledWith(carriesTransaction);
    });
});

describe("fromParsedStructures", () => {
    test("the specimen branch reads the precomputed row through the transaction", async () => {
        stubEvents();
        defineSequelize(Annotation);

        const specimenSpaceReconstruction = prototypeStub(SpecimenSpaceReconstruction, {id: "specimen-space-1", annotationId: "instance-1"});
        specimenSpaceReconstruction.replaceNodeData = vi.fn().mockResolvedValue(undefined);
        const findSpecimenSpace = vi.spyOn(SpecimenSpaceReconstruction, "findOne").mockResolvedValue(specimenSpaceReconstruction);

        const findOne = vi.spyOn(SpecimenSpacePrecomputed, "findOne")
            .mockResolvedValue({requestGeneration: vi.fn().mockResolvedValue(undefined)} as any);

        const reconstruction = prototypeStub(Annotation, {
            neuronId: "neuron-1",
            status: AnnotationStatus.PublishReview
        });

        vi.spyOn(Annotation, "findByPk").mockResolvedValue(reconstruction);

        await reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Specimen, reconstructionData());

        expect(findSpecimenSpace).toHaveBeenCalledWith(carriesTransaction);
        expect(findOne).toHaveBeenCalledWith(carriesTransaction);
    });

    test("the atlas branch locks the neuron, the child and the parent through the transaction", async () => {
        stubEvents();
        defineSequelize(Annotation);

        const atlasReconstruction = {replaceNodeData: vi.fn().mockResolvedValue(undefined)};

        const reconstruction = prototypeStub(Annotation, {
            neuronId: "neuron-1",
            status: AnnotationStatus.PublishReview
        });

        const findAtlas = vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(atlasReconstruction as any);
        // atlasSoma is already populated, so the soma back-fill branch is skipped.
        const findNeuron = vi.spyOn(Neuron, "findByPk").mockResolvedValue({specimenId: "specimen-1", atlasSoma: {x: 1, y: 2, z: 3}} as any);
        const findParent = vi.spyOn(Annotation, "findByPk").mockResolvedValue(reconstruction);
        const findSpecimenAtlas = vi.spyOn(Specimen, "findAtlasId").mockResolvedValue("atlas-1");
        vi.spyOn(Atlas, "getAtlas").mockReturnValue({id: "atlas-1"} as any);

        await reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(findNeuron).toHaveBeenCalledWith("neuron-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
        expect(findAtlas).toHaveBeenCalledWith(carriesTransaction);
        expect(findParent).toHaveBeenCalledWith("instance-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
        expect(findSpecimenAtlas).toHaveBeenCalledWith("specimen-1", transaction);
    });
});

describe("replaceNodeData", () => {
    test("SpecimenSpaceReconstruction clears the soma reference inside the transaction", async () => {
        stubEvents();

        vi.spyOn(SpecimenNode, "destroy").mockResolvedValue(0);
        vi.spyOn(SpecimenNode, "bulkCreate").mockResolvedValue([] as any);
        vi.spyOn(SpecimenNode, "create").mockResolvedValue({id: "soma-1"} as any);

        const specimenSpaceReconstruction = prototypeStub(SpecimenSpaceReconstruction, {annotationId: "annotation-1"});

        await specimenSpaceReconstruction.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), transaction);

        expect(specimenSpaceReconstruction.update.mock.calls[0]).toEqual([{somaNodeId: null}, {transaction: transaction}]);
    });

    test("AtlasReconstruction clears the soma reference inside the transaction", async () => {
        stubEvents();

        vi.spyOn(AtlasNode, "destroy").mockResolvedValue(0);
        vi.spyOn(AtlasNode, "bulkCreate").mockResolvedValue([] as any);
        vi.spyOn(AtlasNode, "create").mockResolvedValue({id: "soma-1"} as any);

        const atlasReconstruction = prototypeStub(AtlasReconstruction, {annotationId: "annotation-1"});

        await atlasReconstruction.replaceNodeData(userWith(UserPermissions.Admin), reconstructionData(), {getFromStructureId: () => null}, transaction);

        expect(atlasReconstruction.update.mock.calls[0]).toEqual([{somaNodeId: null}, {transaction: transaction}]);
    });
});
