import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {Reconstruction} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {ReconstructionSpace} = require("../src/models/reconstructionSpace");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpacePrecomputed} = require("../src/models/specimenSpacePrecomputed");
const {QualityControl} = require("../src/models/qualityControl");
const {Precomputed} = require("../src/models/precomputed");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");

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

function reconstructionStub(status: number, atlasReconstruction: any) {
    const reconstruction = Object.create(Reconstruction.prototype);
    reconstruction.id = "reconstruction-1";
    reconstruction.neuronId = "neuron-1";
    reconstruction.status = status;
    reconstruction.update = updateMock(reconstruction);
    reconstruction.getAtlasReconstruction = vi.fn().mockResolvedValue(atlasReconstruction);
    // atlasSoma is already populated, so the soma back-fill branch is skipped.
    reconstruction.getNeuron = vi.fn().mockResolvedValue({atlasSoma: {x: 1, y: 2, z: 3}});
    return reconstruction;
}

function atlasStub(prepareResult: boolean, reviewerId: string = null) {
    return {
        id: "atlas-1",
        reviewerId: reviewerId,
        replaceNodeData: vi.fn().mockResolvedValue(undefined),
        prepareToFinalize: vi.fn().mockResolvedValue(prepareResult),
        approve: vi.fn().mockResolvedValue(prepareResult)
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

        return reconstructionStub(status, atlasStub(true));
    }

    test.each([ReconstructionStatus.PeerReview, ReconstructionStatus.PublishReview])("accepts %s", async (status: number) => {
        const reconstruction = specimenStubs(status);

        await reconstruction.fromParsedStructures(userWith(UserPermissions.PeerReview | UserPermissions.PublishReview), ReconstructionSpace.Specimen, reconstructionData());

        expect((Reconstruction.prototype as any).replaceNodeData).toHaveBeenCalledTimes(1);
    });

    // A6: the admin bypass is gone, so the status alone decides.
    test.each(allStatuses.filter(status => status !== ReconstructionStatus.PeerReview && status !== ReconstructionStatus.PublishReview))(
        "refuses %s even for an admin",
        async (status: number) => {
            const reconstruction = specimenStubs(status);

            await expect(reconstruction.fromParsedStructures(userWith(UserPermissions.Admin), ReconstructionSpace.Specimen, reconstructionData()))
                .rejects.toThrow(/not in peer or publish review/);

            expect((Reconstruction.prototype as any).replaceNodeData).not.toHaveBeenCalled();
        });
});

describe("fromParsedStructures in atlas space", () => {
    function atlasStubs(status: number, prepareResult: boolean = true, reviewerId: string = null) {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        defineSequelize(Reconstruction);

        const atlasReconstruction = atlasStub(prepareResult, reviewerId);

        return {
            reconstruction: reconstructionStub(status, atlasReconstruction),
            atlasReconstruction: atlasReconstruction
        };
    }

    test.each([ReconstructionStatus.PublishReview, ReconstructionStatus.Approved])("accepts %s", async (status: number) => {
        const stubs = atlasStubs(status);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.atlasReconstruction.replaceNodeData).toHaveBeenCalledTimes(1);
    });

    test.each(allStatuses.filter(status => status !== ReconstructionStatus.PublishReview && status !== ReconstructionStatus.Approved))(
        "refuses %s",
        async (status: number) => {
            const stubs = atlasStubs(status);

            await expect(stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.Admin), ReconstructionSpace.Atlas, reconstructionData()))
                .rejects.toThrow(/not in publish review/);

            expect(stubs.atlasReconstruction.replaceNodeData).not.toHaveBeenCalled();
        });

    // B1's exit: the upload is what starts the automatic phases the stalled approval could not.
    test("from Approved it finalizes and advances to WaitingForAtlasReconstruction", async () => {
        const stubs = atlasStubs(ReconstructionStatus.Approved);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.atlasReconstruction.prepareToFinalize).toHaveBeenCalledTimes(1);
        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.WaitingForAtlasReconstruction);
    });

    test("from PublishReview it neither finalizes nor advances", async () => {
        const stubs = atlasStubs(ReconstructionStatus.PublishReview);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.atlasReconstruction.prepareToFinalize).not.toHaveBeenCalled();
        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.PublishReview);
    });

    test("a false return from prepareToFinalize leaves the status at Approved", async () => {
        const stubs = atlasStubs(ReconstructionStatus.Approved, false);

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.reconstruction.status).toBe(ReconstructionStatus.Approved);
    });

    // The approver recorded at approval time is who the DOI credits, not whoever happened to upload the data.
    test("the uploader does not become the child's reviewer", async () => {
        const stubs = atlasStubs(ReconstructionStatus.Approved, true, "approver-1");

        await stubs.reconstruction.fromParsedStructures(userWith(UserPermissions.PublishReview, "uploader-2"), ReconstructionSpace.Atlas, reconstructionData());

        expect(stubs.atlasReconstruction.reviewerId).toBe("approver-1");
        expect(stubs.atlasReconstruction.approve).not.toHaveBeenCalled();
    });
});

describe("AtlasReconstruction.approve", () => {
    test("records the reviewer and the event even with no node counts, and reports that it did not advance", async () => {
        const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});

        const atlasReconstruction = Object.create(AtlasReconstruction.prototype);
        atlasReconstruction.id = "atlas-1";
        atlasReconstruction.reconstructionId = "reconstruction-1";
        atlasReconstruction.nodeCounts = null;
        atlasReconstruction.update = updateMock(atlasReconstruction);

        const advanced = await atlasReconstruction.approve(userWith(UserPermissions.PublishReview, "approver-1"), transaction);

        expect(advanced).toBe(false);
        expect(atlasReconstruction.reviewerId).toBe("approver-1");
        expect(create.mock.calls[0][0]).toMatchObject({kind: EventLogItemKind.AtlasReconstructionApprove});
    });

    test("with node counts it also starts the automatic phases", async () => {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
        vi.spyOn(QualityControl, "findOne").mockResolvedValue(null);
        vi.spyOn(QualityControl, "createForReconstruction").mockResolvedValue({id: "qc-1"} as any);
        vi.spyOn(Precomputed, "findOne").mockResolvedValue({id: "precomputed-1"} as any);

        const atlasReconstruction = Object.create(AtlasReconstruction.prototype);
        atlasReconstruction.id = "atlas-1";
        atlasReconstruction.reconstructionId = "reconstruction-1";
        atlasReconstruction.nodeCounts = {};
        atlasReconstruction.update = updateMock(atlasReconstruction);

        const advanced = await atlasReconstruction.approve(userWith(UserPermissions.PublishReview, "approver-1"), transaction);

        expect(advanced).toBe(true);
        expect(atlasReconstruction.reviewerId).toBe("approver-1");
    });
});
