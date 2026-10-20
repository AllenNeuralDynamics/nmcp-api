import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {Neuron} = require("../src/models/neuron");
const {PublishedCandidateBlockingStatuses} = require("../src/models/reconstruction");
const {openResolvers} = require("../src/graphql/openResolvers");

// Valid version 4 UUIDs whose string order is their numeric order, as Postgres orders them.
function neuronId(index: number): string {
    return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const rowComparison = "(\"Specimen\".\"label\", \"Neuron\".\"label\", \"Neuron\".\"id\") < (:offsetSpecimenLabel, :offsetNeuronLabel, :offsetNeuronId)";

const target = {id: neuronId(5), label: "N005", Specimen: {label: "S002"}};

function predicateSql(options: any): string[] {
    return options.where[Op.and].map((predicate: any) => predicate.val);
}

function stubQueries(found: any = target, total: number = 0) {
    const findOne = vi.spyOn(Neuron, "findOne").mockResolvedValue(found);
    const count = vi.spyOn(Neuron, "count").mockResolvedValue(total);

    return {findOne, count};
}

function callOptions(spy: any): any {
    return spy.mock.calls[0][0];
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("getCandidateNeuronOffset ids", () => {
    test("a malformed id is refused before any query", async () => {
        const {findOne, count} = stubQueries();

        await expect(Neuron.getCandidateNeuronOffset("not-a-uuid", {})).rejects.toThrow(/not a valid neuron id/);

        expect(findOne).not.toHaveBeenCalled();
        expect(count).not.toHaveBeenCalled();
    });

    test("an id that is not a candidate returns null without counting", async () => {
        const {count} = stubQueries(null);

        expect(await Neuron.getCandidateNeuronOffset(neuronId(5), {})).toBeNull();

        expect(count).not.toHaveBeenCalled();
    });
});

describe("getCandidateNeuronOffset membership", () => {
    test("looks the id up through the table's filter, ignoring offset and limit", async () => {
        const {findOne} = stubQueries();

        await Neuron.getCandidateNeuronOffset(neuronId(5), {offset: 40, limit: 20});

        const options = callOptions(findOne);

        expect(options.where.id).toBe(neuronId(5));
        expect(options.attributes).toEqual(["id", "label"]);
        expect(options.raw).toBe(true);
        expect(options.nest).toBe(true);
        expect(options).not.toHaveProperty("offset");
        expect(options).not.toHaveProperty("limit");
        expect(options).not.toHaveProperty("order");
        expect(options.include.find((include: any) => include.as === "Specimen").attributes).toEqual(["label"]);
    });

    test("the same arguments build the table's predicates and replacements", async () => {
        const input = {keywords: ["axon"], specimenIds: ["specimen-1"]};

        const {findOne} = stubQueries(null);
        const findAll = vi.spyOn(Neuron, "findAll").mockResolvedValue([]);

        await Neuron.getCandidateNeurons(input, true, []);
        await Neuron.getCandidateNeuronOffset(neuronId(5), input, true, []);

        const table = callOptions(findAll);
        const membership = callOptions(findOne);

        expect(predicateSql(membership)).toEqual(predicateSql(table));
        expect(membership.where["$Specimen.id$"]).toEqual(table.where["$Specimen.id$"]);
        expect(membership.where.keywords.val).toEqual(table.where.keywords.val);
        expect(membership.replacements).toEqual(table.replacements);
    });
});

describe("getCandidateNeuronOffset count", () => {
    test("counts the candidates that sort before the target", async () => {
        const {findOne, count} = stubQueries(target, 37);

        expect(await Neuron.getCandidateNeuronOffset(neuronId(5), {})).toBe(37);

        const membership = callOptions(findOne);
        const options = callOptions(count);
        const sql = predicateSql(options);

        expect(sql).toHaveLength(predicateSql(membership).length + 1);
        expect(sql.slice(0, -1)).toEqual(predicateSql(membership));
        expect(sql[sql.length - 1]).toContain(rowComparison);
        expect(options.replacements).toEqual({
            ...membership.replacements,
            offsetSpecimenLabel: "S002",
            offsetNeuronLabel: "N005",
            offsetNeuronId: neuronId(5)
        });
        expect(options).not.toHaveProperty("order");
        expect(sql.join(" ")).not.toContain("ROW_NUMBER");
        expect(predicateSql(membership).join(" ")).not.toContain("ROW_NUMBER");
    });

    test("the count does not change the membership query's predicates", async () => {
        const {findOne, count} = stubQueries(target, 0);

        await Neuron.getCandidateNeuronOffset(neuronId(5), {});

        const membership = callOptions(findOne);

        expect(membership.where[Op.and]).not.toBe(callOptions(count).where[Op.and]);
        expect(predicateSql(membership).some(sql => sql.includes(":offsetSpecimenLabel"))).toBe(false);
    });
});

describe("getCandidateNeuronOffset filters and flags", () => {
    test("keywords and specimenIds reach both queries", async () => {
        const {findOne, count} = stubQueries(target, 0);

        await Neuron.getCandidateNeuronOffset(neuronId(5), {keywords: ["axon"], specimenIds: ["specimen-1"]});

        for (const options of [callOptions(findOne), callOptions(count)]) {
            expect(options.where.keywords).toBeDefined();
            expect(options.replacements.neuronKeywords).toBeDefined();
            expect(options.where["$Specimen.id$"]).toEqual({[Op.in]: ["specimen-1"]});
        }
    });

    test("includeInProgress binds the published-only blocking list in both", async () => {
        const {findOne, count} = stubQueries(target, 0);

        await Neuron.getCandidateNeuronOffset(neuronId(5), {}, true);

        expect(callOptions(findOne).replacements.candidateBlockingStatuses).toBe(PublishedCandidateBlockingStatuses);
        expect(callOptions(count).replacements.candidateBlockingStatuses).toBe(PublishedCandidateBlockingStatuses);
    });

    test("an empty excluded list leaves no excluded predicate in either", async () => {
        const {findOne, count} = stubQueries(target, 0);

        await Neuron.getCandidateNeuronOffset(neuronId(5), {}, false, []);

        for (const options of [callOptions(findOne), callOptions(count)]) {
            expect(predicateSql(options).join(" ")).not.toContain(":candidateExcludedStatuses");
            expect(options.replacements).not.toHaveProperty("candidateExcludedStatuses");
        }
    });
});

describe("candidateNeuronOffset resolver", () => {
    test("passes the arguments through, turning a null excluded list into the default", async () => {
        const offset = vi.spyOn(Neuron, "getCandidateNeuronOffset").mockResolvedValue(3);

        const result = await openResolvers.Query.candidateNeuronOffset(null, {id: neuronId(5), input: {}, includeInProgress: true, excludedReconstructionStatuses: null});

        expect(result).toBe(3);
        expect(offset).toHaveBeenCalledWith(neuronId(5), {}, true, undefined);
    });
});
