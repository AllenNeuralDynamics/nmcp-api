import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron, NeuronStatusFilter} = require("../src/models/neuron");
const {CandidateBlockingStatuses, PublishedCandidateBlockingStatuses, CandidateExcludedStatuses} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {Atlas} = require("../src/models/atlas");

// The candidate query runs no SQL here, so these assert on the options it builds: the correlated predicates, the
// status lists they bind, and the paging handed to findAll.
function stubQueries(total: number = 0, rows: any[] = []) {
    const count = vi.spyOn(Neuron, "count").mockResolvedValue(total);
    const findAll = vi.spyOn(Neuron, "findAll").mockResolvedValue(rows);

    return {count, findAll};
}

function predicateSql(options: any): string[] {
    return options.where[Op.and].map((predicate: any) => predicate.val);
}

function pageOptions(findAll: any): any {
    return findAll.mock.calls[0][0];
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("getCandidateNeurons blocking statuses", () => {
    test("the default blocks on every live reconstruction at a status that holds a neuron", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({});

        const options = pageOptions(findAll);
        const blocking = predicateSql(options)[0];

        expect(blocking).toContain("NOT EXISTS");
        expect(blocking).toContain("\"deletedAt\" IS NULL");
        expect(blocking).toContain(":candidateBlockingStatuses");
        expect(options.replacements.candidateBlockingStatuses).toBe(CandidateBlockingStatuses);
    });

    test("includeInProgress blocks on the published-only list", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({}, true);

        expect(pageOptions(findAll).replacements.candidateBlockingStatuses).toBe(PublishedCandidateBlockingStatuses);
    });
});

// Each of these was a row-level case against the id sweep; the predicates now hand the same lists to Postgres.
describe("candidate status lists", () => {
    const blockingLists = [CandidateBlockingStatuses, PublishedCandidateBlockingStatuses];

    test.each([ReconstructionStatus.OnHold, ReconstructionStatus.Archived])("a %s row neither blocks nor excludes", (status: number) => {
        for (const list of blockingLists) {
            expect(list).not.toContain(status);
        }

        expect(CandidateExcludedStatuses).not.toContain(status);
    });

    test.each([ReconstructionStatus.Incomplete, ReconstructionStatus.Duplicate])("a %s row is excluded by default but never blocks", (status: number) => {
        for (const list of blockingLists) {
            expect(list).not.toContain(status);
        }

        expect(CandidateExcludedStatuses).toContain(status);
    });

    test.each([ReconstructionStatus.Rejected, ReconstructionStatus.Publishing])("a %s row blocks by default", (status: number) => {
        expect(CandidateBlockingStatuses).toContain(status);
    });

    test("only a publication blocks once includeInProgress is set", () => {
        expect(PublishedCandidateBlockingStatuses).not.toContain(ReconstructionStatus.Rejected);

        for (const status of [ReconstructionStatus.Publishing, ReconstructionStatus.PublishFailed, ReconstructionStatus.Published]) {
            expect(PublishedCandidateBlockingStatuses).toContain(status);
        }
    });

    test("the default exclusions are Untraceable, Duplicate and Incomplete", () => {
        expect([...CandidateExcludedStatuses].sort()).toEqual([
            ReconstructionStatus.Untraceable,
            ReconstructionStatus.Duplicate,
            ReconstructionStatus.Incomplete
        ].sort());
    });
});

describe("getCandidateNeurons excluded reconstruction statuses", () => {
    test("the default excludes on every reconstruction, soft-deleted ones included", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({});

        const options = pageOptions(findAll);
        const excluded = predicateSql(options)[1];

        expect(excluded).toContain("NOT EXISTS");
        expect(excluded).toContain(":candidateExcludedStatuses");
        expect(excluded).not.toContain("deletedAt");
        expect(options.replacements.candidateExcludedStatuses).toBe(CandidateExcludedStatuses);
    });

    test("an explicit list replaces the default", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({}, false, [ReconstructionStatus.OnHold]);

        expect(pageOptions(findAll).replacements.candidateExcludedStatuses).toEqual([ReconstructionStatus.OnHold]);
    });

    test("an empty list excludes nothing, and blocking still applies", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({}, false, []);

        const options = pageOptions(findAll);
        const sql = predicateSql(options);

        expect(sql).toHaveLength(1);
        expect(sql[0]).toContain(":candidateBlockingStatuses");
        expect(options.replacements).not.toHaveProperty("candidateExcludedStatuses");
    });

    test("excludes alongside includeInProgress", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({}, true);

        const options = pageOptions(findAll);

        expect(predicateSql(options)).toHaveLength(2);
        expect(options.replacements.candidateBlockingStatuses).toBe(PublishedCandidateBlockingStatuses);
        expect(options.replacements.candidateExcludedStatuses).toBe(CandidateExcludedStatuses);
    });
});

describe("getCandidateNeurons status filter", () => {
    test.each([
        {status: NeuronStatusFilter.Published, comparison: "= :candidatePublishedStatus"},
        {status: NeuronStatusFilter.Unpublished, comparison: "<> :candidatePublishedStatus"}
    ])("status $status is a correlated predicate rather than a has-many join", async ({status, comparison}) => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({status});

        const options = pageOptions(findAll);
        const filter = predicateSql(options)[2];

        expect(filter).toMatch(/^EXISTS/);
        expect(filter).toContain(comparison);
        expect(filter).toContain("\"deletedAt\" IS NULL");
        expect(options.replacements.candidatePublishedStatus).toBe(ReconstructionStatus.Published);
        expect(options.include.some((include: any) => include.as === "SpecimenReconstruction")).toBe(false);
    });
});

describe("getCandidateNeurons shared filters", () => {
    const atlas = {id: "atlas-1", getComprehensiveBrainArea: (structureId: string) => structureId === "region-a" ? ["region-a", "region-a-child"] : null};

    function stubAtlas() {
        vi.spyOn(Atlas, "getAtlasForStructure").mockImplementation((structureId: any) => structureId === "region-a" ? atlas : null);
    }

    test("keywords add their predicate without displacing the candidate replacements", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({keywords: ["axon"]});

        const options = pageOptions(findAll);

        expect(options.where.keywords).toBeDefined();
        expect(options.replacements.neuronKeywords).toBeDefined();
        expect(options.replacements.candidateBlockingStatuses).toBe(CandidateBlockingStatuses);
    });

    test("specimenIds filter on the joined specimen", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({specimenIds: ["specimen-1"]});

        expect(pageOptions(findAll).where["$Specimen.id$"][Op.in]).toEqual(["specimen-1"]);
    });

    test("filters on the owning atlas's subtree", async () => {
        const {findAll} = stubQueries();
        stubAtlas();

        await Neuron.getCandidateNeurons({atlasStructureIds: ["region-a"]});

        expect(pageOptions(findAll).where.atlasStructureId[Op.in]).toEqual(["region-a", "region-a-child"]);
    });

    test("an unknown structure id is rejected before any query", async () => {
        const {count, findAll} = stubQueries();
        stubAtlas();

        await expect(Neuron.getCandidateNeurons({atlasStructureIds: ["missing-id"]})).rejects.toThrow(/Atlas structures not found/);

        expect(count).not.toHaveBeenCalled();
        expect(findAll).not.toHaveBeenCalled();
    });

    test("a null input is the unfiltered candidate set", async () => {
        const {findAll} = stubQueries();

        await expect(Neuron.getCandidateNeurons(null)).resolves.toMatchObject({offset: 0});

        expect(predicateSql(pageOptions(findAll))).toHaveLength(2);
    });
});

describe("getCandidateNeurons count and page", () => {
    test("count and page share one filter", async () => {
        const {count, findAll} = stubQueries();

        await Neuron.getCandidateNeurons({keywords: ["axon"]});

        const countOptions = count.mock.calls[0][0] as any;
        const options = pageOptions(findAll);

        expect(countOptions.where).toBe(options.where);
        expect(countOptions.replacements).toBe(options.replacements);
    });

    test("orders by specimen label, neuron label, then id", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({});

        expect(pageOptions(findAll).order).toEqual([["Specimen", "label", "ASC"], ["label", "ASC"], ["id", "ASC"]]);
    });

    test("loads the whole specimen, so the specimen field can reuse it", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({});

        const specimen = pageOptions(findAll).include.find((include: any) => include.as === "Specimen");

        expect(specimen).toBeDefined();
        expect(specimen).not.toHaveProperty("attributes");
    });
});

describe("getCandidateNeurons offsets", () => {
    test("an unaligned offset is used as given", async () => {
        const {findAll} = stubQueries(100);

        const output = await Neuron.getCandidateNeurons({offset: 37, limit: 20});

        expect(pageOptions(findAll).offset).toBe(37);
        expect(pageOptions(findAll).limit).toBe(20);
        expect(output.offset).toBe(37);
    });

    test("an offset past the end is not clamped back", async () => {
        const {findAll} = stubQueries(100, []);

        const output = await Neuron.getCandidateNeurons({offset: 120, limit: 20});

        expect(pageOptions(findAll).offset).toBe(120);
        expect(output).toEqual({totalCount: 100, offset: 120, items: []});
    });

    test("a negative offset becomes zero", async () => {
        const {findAll} = stubQueries();

        const output = await Neuron.getCandidateNeurons({offset: -5});

        expect(pageOptions(findAll).offset).toBe(0);
        expect(output.offset).toBe(0);
    });

    test("no limit applies none", async () => {
        const {findAll} = stubQueries();

        await Neuron.getCandidateNeurons({});

        expect(pageOptions(findAll)).not.toHaveProperty("limit");
    });

    test("does not route through setSortAndLimiting", async () => {
        stubQueries();
        const setSortAndLimiting = vi.spyOn(Neuron as any, "setSortAndLimiting");

        await Neuron.getCandidateNeurons({offset: 10, limit: 10});

        expect(setSortAndLimiting).not.toHaveBeenCalled();
    });
});
