import {expect, test, vi, describe, afterEach, beforeEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron} = require("../src/models/neuron");
const {Annotation} = require("../src/models/annotation");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {SpecimenSpaceReconstruction} = require("../src/models/specimenSpaceReconstruction");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {getNeuronVersionHistory} = require("../src/models/neuronVersionHistory");

function at(minute: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, minute));
}

function event(id: string, kind: number, targetId: string, parentId: string, minute: number) {
    return {id, kind, targetId, parentId, createdAt: at(minute)};
}

// annotation-1 predates the split, so its specimen-space row reuses its id; annotation-2 was opened after it.
const annotations = [
    {id: "annotation-2", status: 100, startedAt: at(30)},
    {id: "annotation-1", status: 1000, startedAt: at(0)}
];

const specimenSpaceRows = [
    {id: "annotation-1", annotationId: "annotation-1"},
    {id: "specimen-space-2", annotationId: "annotation-2"}
];

const atlasRows = [
    {id: "atlas-1", annotationId: "annotation-1"},
    {id: "atlas-2", annotationId: "annotation-2"}
];

const events = [
    event("create-1", EventLogItemKind.AnnotationCreate, "annotation-1", "neuron-1", 1),
    event("legacy-upload-1", EventLogItemKind.ReconstructionUpload, "annotation-1", "neuron-1", 2),
    event("legacy-precomputed-1", EventLogItemKind.PrecomputedCreate, "precomputed-1", "annotation-1", 3),
    event("atlas-create-1", EventLogItemKind.AtlasReconstructionCreate, "atlas-1", "annotation-1", 4),
    event("create-2", EventLogItemKind.AnnotationCreate, "annotation-2", "neuron-1", 31),
    event("specimen-space-create-2", EventLogItemKind.SpecimenSpaceReconstructionCreate, "specimen-space-2", "annotation-2", 32),
    event("atlas-create-2", EventLogItemKind.AtlasReconstructionCreate, "atlas-2", "annotation-2", 33),
    event("specimen-space-upload-2", EventLogItemKind.SpecimenSpaceReconstructionUpload, "specimen-space-2", "annotation-2", 34),
    event("precomputed-update-2", EventLogItemKind.PrecomputedUpdate, "precomputed-2", "specimen-space-2", 35),
    event("quality-control-2", EventLogItemKind.AtlasQualityControlCreate, "qc-2", "atlas-2", 36),
    event("raw-upload-2", EventLogItemKind.RawReconstructionUploadCreate, "raw-upload-attempt-2", "annotation-2", 37),
    event("raw-create-2", EventLogItemKind.RawReconstructionCreate, "raw-2", "annotation-2", 38)
];

// Every operator present on the condition must hold, as Sequelize ANDs the operators on one attribute.
function matches(value: any, condition: any): boolean {
    if (condition === null || typeof condition !== "object") {
        return value === condition;
    }

    const checks: boolean[] = [];

    if (condition[Op.in]) {
        checks.push(condition[Op.in].includes(value));
    }

    if (condition[Op.between]) {
        checks.push(value >= condition[Op.between][0] && value <= condition[Op.between][1]);
    }

    if (condition[Op.notBetween]) {
        checks.push(value < condition[Op.notBetween][0] || value > condition[Op.notBetween][1]);
    }

    if (condition[Op.gte] !== undefined) {
        checks.push(value >= condition[Op.gte]);
    }

    return checks.length > 0 ? checks.every(check => check) : value === condition;
}

let stubs: any;

beforeEach(() => {
    stubs = {
        findAnnotations: vi.spyOn(Annotation, "findAll").mockResolvedValue(annotations),
        findSpecimenSpace: vi.spyOn(SpecimenSpaceReconstruction, "findAll").mockResolvedValue(specimenSpaceRows),
        findAtlas: vi.spyOn(AtlasReconstruction, "findAll").mockResolvedValue(atlasRows),
        findEvents: vi.spyOn(EventLogItem, "findAll").mockImplementation(async (query: any) =>
            events.filter(item => Object.entries(query.where).every(([key, condition]) => matches((item as any)[key], condition))))
    };

    vi.spyOn(Neuron, "findByPk").mockResolvedValue({id: "neuron-1", specimenId: "specimen-1"});
});

afterEach(() => {
    vi.restoreAllMocks();
});

function branch(history: any, annotationId: string) {
    return history.branches.find((item: any) => item.annotationId === annotationId);
}

function eventIds(history: any, annotationId: string): string[] {
    return branch(history, annotationId).events.map((item: any) => item.id);
}

describe("getNeuronVersionHistory", () => {
    test("each annotation is a branch keyed by annotationId, ordered by startedAt", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(history.branches.map((item: any) => item.annotationId)).toEqual(["annotation-1", "annotation-2"]);
        expect(branch(history, "annotation-1")).toMatchObject({status: 1000, startedAt: at(0)});
        expect(branch(history, "annotation-2")).toMatchObject({status: 100, startedAt: at(30)});
    });

    test("orders the events within a branch by createdAt", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(eventIds(history, "annotation-2")).toEqual([
            "create-2",
            "specimen-space-create-2",
            "atlas-create-2",
            "specimen-space-upload-2",
            "precomputed-update-2",
            "quality-control-2"
        ]);
    });

    test("an annotation event and a legacy upload land in their annotation's branch", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(eventIds(history, "annotation-1")).toEqual(expect.arrayContaining(["create-1", "legacy-upload-1"]));
    });

    test("specimen-space events, parented by the annotation, land in its branch", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(eventIds(history, "annotation-2")).toEqual(expect.arrayContaining(["specimen-space-create-2", "specimen-space-upload-2"]));
    });

    test("a precomputed event parented by a post-split specimen-space row lands in its annotation's branch", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(eventIds(history, "annotation-2")).toContain("precomputed-update-2");
        expect(eventIds(history, "annotation-1")).not.toContain("precomputed-update-2");
    });

    test("where the specimen-space id is the annotation id, the parent is queried once and its event appears once", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        const childQuery = stubs.findEvents.mock.calls
            .map((call: any[]) => call[0].where)
            .find((where: any) => where.kind?.[Op.gte] === EventLogItemKind.AtlasReconstructionCreate);

        const parents: string[] = childQuery.parentId[Op.in];

        expect(parents.filter(parent => parent === "annotation-1")).toHaveLength(1);
        expect(parents).toEqual(expect.arrayContaining(["annotation-1", "annotation-2", "specimen-space-2"]));
        expect(eventIds(history, "annotation-1").filter(id => id === "legacy-precomputed-1")).toHaveLength(1);
    });

    test("atlas events and atlas-child events land in their branch", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(eventIds(history, "annotation-1")).toContain("atlas-create-1");
        expect(eventIds(history, "annotation-2")).toEqual(expect.arrayContaining(["atlas-create-2", "quality-control-2"]));
    });

    test("annotations and specimen-space rows are read past paranoid", async () => {
        await getNeuronVersionHistory("neuron-1");

        expect(stubs.findAnnotations.mock.calls[0][0]).toMatchObject({where: {neuronId: "neuron-1"}, paranoid: false});
        expect(stubs.findSpecimenSpace.mock.calls[0][0]).toMatchObject({
            where: {annotationId: {[Op.in]: ["annotation-2", "annotation-1"]}},
            attributes: ["id", "annotationId"],
            paranoid: false
        });
    });
});

describe("raw reconstruction events", () => {
    test("stay out of the annotation's branch", async () => {
        const history = await getNeuronVersionHistory("neuron-1");

        expect(eventIds(history, "annotation-2")).not.toContain("raw-upload-2");
        expect(eventIds(history, "annotation-2")).not.toContain("raw-create-2");
    });

    test("are excluded by the annotation-child query's kind", async () => {
        await getNeuronVersionHistory("neuron-1");

        const childQuery = stubs.findEvents.mock.calls
            .map((call: any[]) => call[0].where)
            .find((where: any) => where.kind?.[Op.gte] === EventLogItemKind.AtlasReconstructionCreate);

        expect(childQuery.kind[Op.notBetween]).toEqual([11000, 11499]);
    });
});
