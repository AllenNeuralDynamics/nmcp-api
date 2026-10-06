import {expect, test, vi, beforeAll, beforeEach, afterEach, describe} from "vitest";
import {Op} from "sequelize";

import {QueryPredicate, PredicateType, PredicateComposition, PredicateShape, AnatomicalPredicateShape, CustomRegionPredicateShape, IdOrDoiPredicateShape} from "../src/models/queryPredicate";
import {GreaterThanOperatorId} from "../src/models/queryOperator";
import {NodeStructure, NodeStructures} from "../src/models/nodeStructure";
import {SearchContext} from "../src/models/searchContext";
import {SearchIndex} from "../src/models/searchIndex";

// require() gives the CJS module instances that compiled transitive dependencies use, so spies land on them.
const {Atlas} = require("../src/models/atlas");
const {Neuron} = require("../src/models/neuron");

const WHOLE_BRAIN_ID = "whole-brain-id";
const REGION_A_ID = "region-a";
const REGION_B_ID = "region-b";
const REGION_A_CHILD_1 = "region-a-child-1";
const REGION_A_CHILD_2 = "region-a-child-2";
const OTHER_ATLAS_REGION_ID = "other-atlas-region";

const FORK_NODE_STRUCTURE_ID = "node-fork-id";
const END_NODE_STRUCTURE_ID = "node-end-id";
const PATH_NODE_STRUCTURE_ID = "node-path-id";
const SOMA_NODE_STRUCTURE_ID = "node-soma-id";

const AXON_NEURON_STRUCTURE_ID = "neuron-axon-id";
const DENDRITE_NEURON_STRUCTURE_ID = "neuron-dendrite-id";
const SOMA_NEURON_STRUCTURE_ID = "neuron-soma-id";

const COLLECTION_1 = "collection-1";
const COLLECTION_2 = "collection-2";

const ATLAS_KIND_1 = "atlas-kind-1";
const ATLAS_KIND_2 = "atlas-kind-2";

const EQ_OPERATOR_ID = "5f21a040-dd64-4116-aa9c-d00387b83db8";
const GT_OPERATOR_ID = "f191e8b3-8fb9-4151-a48c-432c1a2382cd";
const LT_OPERATOR_ID = "ca6dc15b-bee7-4ee5-b53c-2d9f244b0312";
const GTE_OPERATOR_ID = GreaterThanOperatorId;
const LTE_OPERATOR_ID = "86934549-1d9c-41e2-8020-d29724ea505e";
const NE_OPERATOR_ID = "2060469a-aa88-4e61-b72c-e598d8e3e243";

function makeAnatomicalShape(
    overrides: Partial<AnatomicalPredicateShape> = {},
    base: Partial<PredicateShape> = {}
): PredicateShape {
    return {
        predicateType: PredicateType.AnatomicalRegion,
        composition: PredicateComposition.or,
        anatomicalPredicate: {
            neuronStructureId: "",
            nodeStructureId: "",
            operatorId: GTE_OPERATOR_ID,
            amount: 0,
            atlasStructureIds: [],
            ...overrides,
        },
        ...base,
    };
}

function makeCustomRegionShape(
    overrides: Partial<CustomRegionPredicateShape> = {},
    base: Partial<PredicateShape> = {}
): PredicateShape {
    return {
        predicateType: PredicateType.CustomRegion,
        composition: PredicateComposition.or,
        customRegionPredicate: {
            arbCenter: {x: 0, y: 0, z: 0},
            arbSize: 0,
            ...overrides,
        },
        ...base,
    };
}

function makeIdOrDoiShape(
    overrides: Partial<IdOrDoiPredicateShape> = {},
    base: Partial<PredicateShape> = {}
): PredicateShape {
    return {
        predicateType: PredicateType.IdOrDoi,
        composition: PredicateComposition.or,
        idOrDoiPredicate: {
            labelsOrDois: [],
            labelOrDoiExactMatch: false,
            ...overrides,
        },
        ...base,
    };
}

beforeAll(() => {
    const nodeStructureModule = require("../src/models/nodeStructure");
    nodeStructureModule.NodeStructure.idValueMap = new Map<string, number>([
        [FORK_NODE_STRUCTURE_ID, NodeStructures.forkPoint],
        [END_NODE_STRUCTURE_ID, NodeStructures.endPoint],
        [PATH_NODE_STRUCTURE_ID, NodeStructures.undefined],
        [SOMA_NODE_STRUCTURE_ID, NodeStructures.soma],
    ]);

    const neuronStructureModule = require("../src/models/neuronStructure");
    neuronStructureModule.NeuronStructure._axonStructure = {id: AXON_NEURON_STRUCTURE_ID};
    neuronStructureModule.NeuronStructure._dendriteStructure = {id: DENDRITE_NEURON_STRUCTURE_ID};
    neuronStructureModule.NeuronStructure._somaNeuronStructure = {id: SOMA_NEURON_STRUCTURE_ID};
});

// ──────────────────────────────────────────────────────────────
// AnatomicalRegion — atlas structure filtering
// ──────────────────────────────────────────────────────────────

describe("AnatomicalRegion — atlas structure filtering", () => {
    const wholeBrainSubtree = [WHOLE_BRAIN_ID, REGION_A_ID, REGION_A_CHILD_1, REGION_A_CHILD_2, REGION_B_ID];

    const primarySubtrees = new Map<string, string[]>([
        [WHOLE_BRAIN_ID, wholeBrainSubtree],
        [REGION_A_ID, [REGION_A_ID, REGION_A_CHILD_1, REGION_A_CHILD_2]],
        [REGION_B_ID, [REGION_B_ID]]
    ]);

    const primaryAtlas = {id: "atlas-primary", getComprehensiveBrainArea: (structureId: string) => primarySubtrees.get(structureId) ?? null};

    const otherAtlas = {id: "atlas-other", getComprehensiveBrainArea: (structureId: string) => structureId === OTHER_ATLAS_REGION_ID ? [OTHER_ATLAS_REGION_ID] : null};

    beforeEach(() => {
        vi.spyOn(Atlas, "getAtlasForStructure").mockImplementation((structureId: any) => {
            if (primarySubtrees.has(structureId)) {
                return primaryAtlas;
            }

            return structureId === OTHER_ATLAS_REGION_ID ? otherAtlas : null;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("no atlas structures means no atlasStructureId filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: []}));
        const options = predicate.createFindOptions([]);

        expect(options.where["atlasStructureId"]).toBeUndefined();
    });

    test("whole brain expands to its subtree like any other structure", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: [WHOLE_BRAIN_ID]}));
        const options = predicate.createFindOptions([], []);

        const filter = options.where["atlasStructureId"];
        expect(filter[Op.in]).toEqual(expect.arrayContaining(wholeBrainSubtree));
        expect(filter[Op.in]).toHaveLength(wholeBrainSubtree.length);
    });

    test("specific region expands to include descendants", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: [REGION_A_ID]}));
        const options = predicate.createFindOptions([]);

        const filter = options.where["atlasStructureId"];
        expect(filter[Op.in]).toEqual(expect.arrayContaining([REGION_A_ID, REGION_A_CHILD_1, REGION_A_CHILD_2]));
        expect(filter[Op.in]).toHaveLength(3);
    });

    test("whole brain with a region is the union of both subtrees", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: [WHOLE_BRAIN_ID, REGION_B_ID]}));
        const options = predicate.createFindOptions([], []);

        const filter = options.where["atlasStructureId"];
        expect(filter[Op.in]).toEqual(expect.arrayContaining(wholeBrainSubtree));
        expect(filter[Op.in]).toHaveLength(wholeBrainSubtree.length);
    });

    test("multiple specific regions are unioned", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: [REGION_A_ID, REGION_B_ID]}));
        const options = predicate.createFindOptions([]);

        const filter = options.where["atlasStructureId"];
        expect(filter[Op.in]).toEqual(expect.arrayContaining([REGION_A_ID, REGION_A_CHILD_1, REGION_A_CHILD_2, REGION_B_ID]));
        expect(filter[Op.in]).toHaveLength(4);
    });

    test("structures from one atlas pin the filter to that atlas", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: [REGION_A_ID, REGION_B_ID]}));
        const options = predicate.createFindOptions([], []);

        expect(options.where["atlasId"]).toBe("atlas-primary");
        expect(options.where[Op.or]).toBeUndefined();
    });

    test("structures from different atlases are each pinned to their own atlas", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: [REGION_B_ID, OTHER_ATLAS_REGION_ID]}));
        const options = predicate.createFindOptions([], []);

        expect(options.where["atlasId"]).toBeUndefined();
        expect(options.where["atlasStructureId"]).toBeUndefined();
        expect(options.where[Op.or]).toEqual([
            {atlasId: "atlas-primary", atlasStructureId: {[Op.in]: [REGION_B_ID]}},
            {atlasId: "atlas-other", atlasStructureId: {[Op.in]: [OTHER_ATLAS_REGION_ID]}}
        ]);
    });

    test("no atlas structures means no atlasId filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: []}));
        const options = predicate.createFindOptions([]);

        expect(options.where["atlasId"]).toBeUndefined();
        expect(options.where[Op.or]).toBeUndefined();
    });

    test("an unknown structure id is rejected", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({atlasStructureIds: ["missing-id"]}));

        expect(() => predicate.createFindOptions([], [])).toThrow(/Atlas structures not found: missing-id/);
    });

    test("searchNeurons reports an unknown structure as an error rather than throwing", async () => {
        const output = await Neuron.getNeuronsWithPredicates(new SearchContext({
            nonce: "n",
            collectionIds: [],
            predicates: [makeAnatomicalShape({atlasStructureIds: ["missing-id"]})]
        }));

        expect(output.error.message).toMatch(/Atlas structures not found: missing-id/);
        expect(output.neurons).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────
// AnatomicalRegion — neuron structure filtering
// ──────────────────────────────────────────────────────────────

describe("AnatomicalRegion — neuron structure filtering", () => {
    test("empty neuronStructureId means no filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({neuronStructureId: ""}));
        const options = predicate.createFindOptions([]);

        expect(options.where["neuronStructureId"]).toBeUndefined();
    });

    test("neuronStructureId with nodeStructureId applies neuronStructureId filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: AXON_NEURON_STRUCTURE_ID,
            nodeStructureId: FORK_NODE_STRUCTURE_ID,
            operatorId: GT_OPERATOR_ID,
            amount: 10,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["neuronStructureId"]).toBe(AXON_NEURON_STRUCTURE_ID);
    });
});

// ──────────────────────────────────────────────────────────────
// AnatomicalRegion — node count filtering
// ──────────────────────────────────────────────────────────────

describe("AnatomicalRegion — node count filtering", () => {
    test("empty nodeStructureId uses nodeCount column", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            operatorId: GTE_OPERATOR_ID,
            amount: 50,
            nodeStructureId: "",
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["nodeCount"][Op.gte]).toBe(50);
    });

    test("fork point nodeStructureId uses branchCount column", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: AXON_NEURON_STRUCTURE_ID,
            operatorId: GT_OPERATOR_ID,
            amount: 10,
            nodeStructureId: FORK_NODE_STRUCTURE_ID,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["branchCount"][Op.gt]).toBe(10);
        expect(options.where["nodeCount"]).toBeUndefined();
    });

    test("end point nodeStructureId uses endCount column", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: AXON_NEURON_STRUCTURE_ID,
            operatorId: EQ_OPERATOR_ID,
            amount: 5,
            nodeStructureId: END_NODE_STRUCTURE_ID,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["endCount"][Op.eq]).toBe(5);
    });

    test("path nodeStructureId uses pathCount column", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: DENDRITE_NEURON_STRUCTURE_ID,
            operatorId: LTE_OPERATOR_ID,
            amount: 20,
            nodeStructureId: PATH_NODE_STRUCTURE_ID,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["pathCount"][Op.lte]).toBe(20);
    });

    test("soma nodeStructureId has no count column — node count filter not applied", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: AXON_NEURON_STRUCTURE_ID,
            operatorId: GT_OPERATOR_ID,
            amount: 100,
            nodeStructureId: SOMA_NODE_STRUCTURE_ID,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["nodeCount"]).toBeUndefined();
        expect(options.where["branchCount"]).toBeUndefined();
        expect(options.where["endCount"]).toBeUndefined();
        expect(options.where["pathCount"]).toBeUndefined();
    });

    test("no operatorId defaults to > 0", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            operatorId: "",
            amount: 999,
            nodeStructureId: "",
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["nodeCount"][Op.gt]).toBe(0);
    });

    test("each operator symbol is applied correctly", () => {
        const cases: [string, symbol][] = [
            [EQ_OPERATOR_ID, Op.eq],
            [NE_OPERATOR_ID, Op.ne],
            [GT_OPERATOR_ID, Op.gt],
            [LT_OPERATOR_ID, Op.lt],
            [GTE_OPERATOR_ID, Op.gte],
            [LTE_OPERATOR_ID, Op.lte],
        ];

        for (const [operatorId, expectedSymbol] of cases) {
            const predicate = new QueryPredicate(makeAnatomicalShape({operatorId, amount: 42}));
            const options = predicate.createFindOptions([]);

            expect(options.where["nodeCount"][expectedSymbol]).toBe(42);
        }
    });
});

// ──────────────────────────────────────────────────────────────
// AnatomicalRegion — compartment length threshold filtering
// ──────────────────────────────────────────────────────────────

describe("AnatomicalRegion — compartment length threshold filtering", () => {
    test("axon neuronStructureId without nodeStructureId uses axonLengthMicrometer column", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: AXON_NEURON_STRUCTURE_ID,
            nodeStructureId: "",
            operatorId: GT_OPERATOR_ID,
            amount: 5000,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["axonLengthMicrometer"][Op.gt]).toBe(5000);
        expect(options.where["dendriteLengthMicrometer"]).toBeUndefined();
        expect(options.where["nodeCount"]).toBeUndefined();
        expect(options.where["neuronStructureId"]).toBeUndefined();
    });

    test("dendrite neuronStructureId without nodeStructureId uses dendriteLengthMicrometer column", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: DENDRITE_NEURON_STRUCTURE_ID,
            nodeStructureId: "",
            operatorId: GTE_OPERATOR_ID,
            amount: 1000,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["dendriteLengthMicrometer"][Op.gte]).toBe(1000);
        expect(options.where["axonLengthMicrometer"]).toBeUndefined();
        expect(options.where["nodeCount"]).toBeUndefined();
        expect(options.where["neuronStructureId"]).toBeUndefined();
    });

    test("soma neuronStructureId without nodeStructureId applies presence filter only", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape({
            neuronStructureId: SOMA_NEURON_STRUCTURE_ID,
            nodeStructureId: "",
            operatorId: GT_OPERATOR_ID,
            amount: 100,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["neuronStructureId"]).toBe(SOMA_NEURON_STRUCTURE_ID);
        expect(options.where["nodeCount"]).toBeUndefined();
        expect(options.where["axonLengthMicrometer"]).toBeUndefined();
        expect(options.where["dendriteLengthMicrometer"]).toBeUndefined();
    });
});

// ──────────────────────────────────────────────────────────────
// Collection filtering (shared across predicate types)
// ──────────────────────────────────────────────────────────────

describe("Collection filtering", () => {
    test("no collectionIds means no collection filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([]);

        expect(options.where["collectionId"]).toBeUndefined();
    });

    test("single collectionId applies direct equality filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([COLLECTION_1]);

        expect(options.where["collectionId"]).toBe(COLLECTION_1);
    });

    test("multiple collectionIds applies IN filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([COLLECTION_1, COLLECTION_2]);

        expect(options.where["collectionId"][Op.in]).toEqual([COLLECTION_1, COLLECTION_2]);
    });

    test("collection filter applied for CustomRegion", () => {
        const predicate = new QueryPredicate(makeCustomRegionShape());
        const options = predicate.createFindOptions([COLLECTION_1]);

        expect(options.where["collectionId"]).toBe(COLLECTION_1);
    });

    test("collection filter applied for IdOrDoi", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: true,
            labelsOrDois: ["N001"],
        }));
        const options = predicate.createFindOptions([COLLECTION_1]);

        expect(options.where["collectionId"]).toBe(COLLECTION_1);
    });
});

describe("Atlas kind filtering", () => {
    test("no atlasKindIds means no atlas kind filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([], []);

        expect(options.where["atlasKindId"]).toBeUndefined();
    });

    test("single atlasKindId applies direct equality filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([], [ATLAS_KIND_1]);

        expect(options.where["atlasKindId"]).toBe(ATLAS_KIND_1);
    });

    test("multiple atlasKindIds applies IN filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([], [ATLAS_KIND_1, ATLAS_KIND_2]);

        expect(options.where["atlasKindId"][Op.in]).toEqual([ATLAS_KIND_1, ATLAS_KIND_2]);
    });

    test("atlas kind filter applied for CustomRegion", () => {
        const predicate = new QueryPredicate(makeCustomRegionShape());
        const options = predicate.createFindOptions([], [ATLAS_KIND_1]);

        expect(options.where["atlasKindId"]).toBe(ATLAS_KIND_1);
    });

    test("atlas kind filter applied for IdOrDoi", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: true,
            labelsOrDois: ["N001"],
        }));
        const options = predicate.createFindOptions([], [ATLAS_KIND_1]);

        expect(options.where["atlasKindId"]).toBe(ATLAS_KIND_1);
    });

    test("atlas kind filter applied alongside a collection filter", () => {
        const predicate = new QueryPredicate(makeAnatomicalShape());
        const options = predicate.createFindOptions([COLLECTION_1], [ATLAS_KIND_1]);

        expect(options.where["collectionId"]).toBe(COLLECTION_1);
        expect(options.where["atlasKindId"]).toBe(ATLAS_KIND_1);
    });
});

// ──────────────────────────────────────────────────────────────
// CustomRegion — createFindOptions
// ──────────────────────────────────────────────────────────────

describe("CustomRegion — createFindOptions", () => {
    test("filters to soma neuron structure only", () => {
        const predicate = new QueryPredicate(makeCustomRegionShape());
        const options = predicate.createFindOptions([]);

        expect(options.where["atlasStructureId"]).toBeUndefined();
        expect(options.where["neuronStructureId"]).toBe(SOMA_NEURON_STRUCTURE_ID);
    });

    test("no spatial filter when arbCenter and arbSize are absent", () => {
        const predicate = new QueryPredicate(makeCustomRegionShape({
            arbCenter: {x: 0, y: 0, z: 0},
            arbSize: 0,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["somaX"]).toBeUndefined();
        expect(options.where["somaY"]).toBeUndefined();
        expect(options.where["somaZ"]).toBeUndefined();
        expect(options.where[Op.and as any]).toBeUndefined();
    });

    test("bounding box filter applied when arbCenter and arbSize are set", () => {
        const predicate = new QueryPredicate(makeCustomRegionShape({
            arbCenter: {x: 100, y: 200, z: 300},
            arbSize: 50,
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["somaX"][Op.between]).toEqual([50, 150]);
        expect(options.where["somaY"][Op.between]).toEqual([150, 250]);
        expect(options.where["somaZ"][Op.between]).toEqual([250, 350]);
    });

    test("squared Euclidean distance filter is included", () => {
        const predicate = new QueryPredicate(makeCustomRegionShape({
            arbCenter: {x: 10, y: 20, z: 30},
            arbSize: 5,
        }));
        const options = predicate.createFindOptions([]);

        const andClause = options.where[Op.and as any];
        expect(andClause).toHaveLength(1);
        expect(andClause[0]).toBeDefined();
    });
});

// ──────────────────────────────────────────────────────────────
// IdOrDoi — createFindOptions
// ──────────────────────────────────────────────────────────────

describe("IdOrDoi — createFindOptions", () => {
    test("exact match with terms uses Op.in on all four fields", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: true,
            labelsOrDois: ["N001", "10.1234/test"],
        }));
        const options = predicate.createFindOptions([]);

        const orClause = options.where[Op.or];
        expect(orClause).toHaveLength(4);

        const neuronLabelClause = orClause.find((clause: any) => clause.neuronLabel);
        const doiClause = orClause.find((clause: any) => clause.doi);
        const canonicalDoiClause = orClause.find((clause: any) => clause.canonicalDoi);
        const specimenClause = orClause.find((clause: any) => clause.specimenLabel);

        expect(neuronLabelClause.neuronLabel[Op.in]).toEqual(["N001", "10.1234/test"]);
        expect(doiClause.doi[Op.in]).toEqual(["N001", "10.1234/test"]);
        expect(canonicalDoiClause.canonicalDoi[Op.in]).toEqual(["N001", "10.1234/test"]);
        expect(specimenClause.specimenLabel[Op.in]).toEqual(["N001", "10.1234/test"]);
    });

    test("exact match with empty terms uses Op.in with empty array", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: true,
            labelsOrDois: [],
        }));
        const options = predicate.createFindOptions([]);

        const orClause = options.where[Op.or];
        expect(orClause).toHaveLength(4);

        const neuronLabelClause = orClause.find((clause: any) => clause.neuronLabel);
        expect(neuronLabelClause.neuronLabel[Op.in]).toEqual([]);
    });

    test("empty terms without explicit exact match falls into exact match path", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: false,
            labelsOrDois: [],
        }));
        const options = predicate.createFindOptions([]);

        const orClause = options.where[Op.or];
        expect(orClause).toHaveLength(4);

        const neuronLabelClause = orClause.find((clause: any) => clause.neuronLabel);
        expect(neuronLabelClause.neuronLabel[Op.in]).toEqual([]);
    });

    test("substring match with single term uses iLike on all four fields", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: false,
            labelsOrDois: ["N0"],
        }));
        const options = predicate.createFindOptions([]);

        const orClause = options.where[Op.or];
        expect(orClause).toHaveLength(4);

        const neuronLabelClause = orClause.find((clause: any) => clause.neuronLabel);
        const doiClause = orClause.find((clause: any) => clause.doi);
        const canonicalDoiClause = orClause.find((clause: any) => clause.canonicalDoi);
        const specimenClause = orClause.find((clause: any) => clause.specimenLabel);

        expect(neuronLabelClause.neuronLabel[Op.iLike]).toBe("%N0%");
        expect(doiClause.doi[Op.iLike]).toBe("%N0%");
        expect(canonicalDoiClause.canonicalDoi[Op.iLike]).toBe("%N0%");
        expect(specimenClause.specimenLabel[Op.iLike]).toBe("%N0%");
    });

    test("substring match with multiple terms creates nested OR of iLike groups", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: false,
            labelsOrDois: ["alpha", "beta"],
        }));
        const options = predicate.createFindOptions([]);

        const outerOr = options.where[Op.or];
        expect(outerOr).toHaveLength(2);

        for (const group of outerOr) {
            const innerOr = group[Op.or];
            expect(innerOr).toHaveLength(4);

            const fields = innerOr.map((clause: any) => Object.keys(clause)[0]);
            expect(fields).toContain("neuronLabel");
            expect(fields).toContain("doi");
            expect(fields).toContain("canonicalDoi");
            expect(fields).toContain("specimenLabel");
        }

        const firstGroupNeuronLabel = outerOr[0][Op.or].find((clause: any) => clause.neuronLabel);
        expect(firstGroupNeuronLabel.neuronLabel[Op.iLike]).toBe("%alpha%");

        const secondGroupNeuronLabel = outerOr[1][Op.or].find((clause: any) => clause.neuronLabel);
        expect(secondGroupNeuronLabel.neuronLabel[Op.iLike]).toBe("%beta%");
    });

    test("no node count filter is applied for IdOrDoi", () => {
        const predicate = new QueryPredicate(makeIdOrDoiShape({
            labelOrDoiExactMatch: true,
            labelsOrDois: ["N001"],
        }));
        const options = predicate.createFindOptions([]);

        expect(options.where["nodeCount"]).toBeUndefined();
        expect(options.where["branchCount"]).toBeUndefined();
        expect(options.where["endCount"]).toBeUndefined();
    });
});

// ──────────────────────────────────────────────────────────────
// SearchContext — constructor behavior
// ──────────────────────────────────────────────────────────────

describe("SearchContext — construction", () => {
    test("null input creates default context", () => {
        const context = new SearchContext(null);

        expect(context.Nonce).toBeDefined();
        expect(context.CollectionIds).toEqual([]);
        expect(context.AtlasKindIds).toEqual([]);
        expect(context.Predicates).toHaveLength(1);
        expect(context.Predicates[0].predicateType).toBe(PredicateType.AnatomicalRegion);
    });

    test("input without atlasKindIds has no atlas kind restriction", () => {
        const context = new SearchContext({nonce: "test", collectionIds: [], predicates: []});

        expect(context.AtlasKindIds).toEqual([]);
    });

    test("provided atlasKindIds are preserved", () => {
        const context = new SearchContext({nonce: "test", collectionIds: [], atlasKindIds: [ATLAS_KIND_1, ATLAS_KIND_2], predicates: []});

        expect(context.AtlasKindIds).toEqual([ATLAS_KIND_1, ATLAS_KIND_2]);
    });

    test("empty predicates array creates default predicate", () => {
        const context = new SearchContext({nonce: "test", collectionIds: [], predicates: []});

        expect(context.Predicates).toHaveLength(1);
        expect(context.Predicates[0].predicateType).toBe(PredicateType.AnatomicalRegion);
        expect(context.Predicates[0].composition).toBe(PredicateComposition.or);
    });

    test("provided predicates are preserved", () => {
        const context = new SearchContext({
            nonce: "test-nonce",
            collectionIds: [COLLECTION_1],
            predicates: [
                makeIdOrDoiShape({labelsOrDois: ["N001"]}),
            ],
        });

        expect(context.Nonce).toBe("test-nonce");
        expect(context.CollectionIds).toEqual([COLLECTION_1]);
        expect(context.Predicates).toHaveLength(1);
        expect(context.Predicates[0].predicateType).toBe(PredicateType.IdOrDoi);
    });
});

// ──────────────────────────────────────────────────────────────
// performNeuronsFilterQuery — composition logic
// Uses IdOrDoi predicates to avoid atlas dependency in findAll
// ──────────────────────────────────────────────────────────────

describe("performNeuronsFilterQuery — composition", () => {
    function mockSearchIndexEntry(neuronId: string) {
        return {id: `si-${neuronId}`, neuronId, somaX: 0, somaY: 0, somaZ: 0};
    }

    function makeIdPredicate(composition: PredicateComposition): PredicateShape {
        return makeIdOrDoiShape(
            {labelOrDoiExactMatch: true, labelsOrDois: ["placeholder"]},
            {composition},
        );
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("atlasKindIds reach every predicate's query", async () => {
        const findAll = vi.spyOn(SearchIndex, "findAll").mockResolvedValue([mockSearchIndexEntry("N1")] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            atlasKindIds: [ATLAS_KIND_1],
            predicates: [makeIdPredicate(PredicateComposition.or), makeIdPredicate(PredicateComposition.and)],
        });

        await SearchIndex.performNeuronsFilterQuery(context);

        expect(findAll).toHaveBeenCalledTimes(2);

        for (const call of findAll.mock.calls) {
            expect((call[0] as any).where.atlasKindId).toBe(ATLAS_KIND_1);
        }
    });

    test("single predicate returns its neuron IDs", async () => {
        vi.spyOn(SearchIndex, "findAll").mockResolvedValueOnce([
            mockSearchIndexEntry("N1"),
            mockSearchIndexEntry("N2"),
        ] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [makeIdPredicate(PredicateComposition.or)],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds).toEqual(expect.arrayContaining(["N1", "N2"]));
        expect(result.neuronIds).toHaveLength(2);
    });

    test("deduplicates neuron IDs from multiple SearchIndex rows", async () => {
        vi.spyOn(SearchIndex, "findAll").mockResolvedValueOnce([
            mockSearchIndexEntry("N1"),
            mockSearchIndexEntry("N1"),
            mockSearchIndexEntry("N2"),
        ] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [makeIdPredicate(PredicateComposition.or)],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds).toEqual(expect.arrayContaining(["N1", "N2"]));
        expect(result.neuronIds).toHaveLength(2);
    });

    test("OR composition unions neuron IDs", async () => {
        vi.spyOn(SearchIndex, "findAll")
            .mockResolvedValueOnce([mockSearchIndexEntry("N1"), mockSearchIndexEntry("N2")] as any)
            .mockResolvedValueOnce([mockSearchIndexEntry("N2"), mockSearchIndexEntry("N3")] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [
                makeIdPredicate(PredicateComposition.or),
                makeIdPredicate(PredicateComposition.or),
            ],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds.sort()).toEqual(["N1", "N2", "N3"]);
    });

    test("AND composition intersects neuron IDs", async () => {
        vi.spyOn(SearchIndex, "findAll")
            .mockResolvedValueOnce([mockSearchIndexEntry("N1"), mockSearchIndexEntry("N2"), mockSearchIndexEntry("N3")] as any)
            .mockResolvedValueOnce([mockSearchIndexEntry("N2"), mockSearchIndexEntry("N3"), mockSearchIndexEntry("N4")] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [
                makeIdPredicate(PredicateComposition.or),
                makeIdPredicate(PredicateComposition.and),
            ],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds.sort()).toEqual(["N2", "N3"]);
    });

    test("NOT composition subtracts neuron IDs", async () => {
        vi.spyOn(SearchIndex, "findAll")
            .mockResolvedValueOnce([mockSearchIndexEntry("N1"), mockSearchIndexEntry("N2"), mockSearchIndexEntry("N3")] as any)
            .mockResolvedValueOnce([mockSearchIndexEntry("N2")] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [
                makeIdPredicate(PredicateComposition.or),
                makeIdPredicate(PredicateComposition.not),
            ],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds.sort()).toEqual(["N1", "N3"]);
    });

    test("first predicate composition is ignored — always contributes its results", async () => {
        vi.spyOn(SearchIndex, "findAll")
            .mockResolvedValueOnce([mockSearchIndexEntry("N1"), mockSearchIndexEntry("N2")] as any)
            .mockResolvedValueOnce([mockSearchIndexEntry("N3")] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [
                makeIdPredicate(PredicateComposition.and),
                makeIdPredicate(PredicateComposition.or),
            ],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds.sort()).toEqual(["N1", "N2", "N3"]);
    });

    test("three predicates composed sequentially: OR then AND then NOT", async () => {
        vi.spyOn(SearchIndex, "findAll")
            .mockResolvedValueOnce([mockSearchIndexEntry("N1"), mockSearchIndexEntry("N2"), mockSearchIndexEntry("N3")] as any)
            .mockResolvedValueOnce([mockSearchIndexEntry("N2"), mockSearchIndexEntry("N3"), mockSearchIndexEntry("N4")] as any)
            .mockResolvedValueOnce([mockSearchIndexEntry("N3")] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [
                makeIdPredicate(PredicateComposition.or),
                makeIdPredicate(PredicateComposition.and),
                makeIdPredicate(PredicateComposition.not),
            ],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds).toEqual(["N2"]);
    });
});

// ──────────────────────────────────────────────────────────────
// performNeuronsFilterQuery — CustomRegion results passthrough
// ──────────────────────────────────────────────────────────────

describe("performNeuronsFilterQuery — CustomRegion", () => {
    function mockSearchIndexEntry(neuronId: string) {
        return {id: `si-${neuronId}`, neuronId};
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("returns neuron IDs from database-filtered results", async () => {
        vi.spyOn(SearchIndex, "findAll").mockResolvedValueOnce([
            mockSearchIndexEntry("N1"),
            mockSearchIndexEntry("N2"),
        ] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [makeCustomRegionShape({
                arbCenter: {x: 0, y: 0, z: 0},
                arbSize: 50,
            })],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.neuronIds).toEqual(expect.arrayContaining(["N1", "N2"]));
        expect(result.neuronIds).toHaveLength(2);
    });
});

// ──────────────────────────────────────────────────────────────
// Default predicate behavior
// ──────────────────────────────────────────────────────────────

describe("Default predicate", () => {
    test("default predicate has expected values", () => {
        const predicate = QueryPredicate.createDefault();

        expect(predicate.predicateType).toBe(PredicateType.AnatomicalRegion);
        expect(predicate.composition).toBe(PredicateComposition.or);
        expect(predicate.anatomicalPredicate?.operatorId).toBe(GTE_OPERATOR_ID);
        expect(predicate.anatomicalPredicate?.amount).toBe(0);
        expect(predicate.anatomicalPredicate?.atlasStructureIds).toEqual([]);
        expect(predicate.anatomicalPredicate?.neuronStructureId).toBe("");
        expect(predicate.anatomicalPredicate?.nodeStructureId).toBe("");
        expect(predicate.idOrDoiPredicate).toBeUndefined();
        expect(predicate.customRegionPredicate).toBeUndefined();
    });

    test("default predicate matches all — no restrictive filters", () => {
        const predicate = QueryPredicate.createDefault();
        const options = predicate.createFindOptions([]);

        expect(options.where["atlasStructureId"]).toBeUndefined();
        expect(options.where["neuronStructureId"]).toBeUndefined();
        expect(options.where["collectionId"]).toBeUndefined();
        expect(options.where["nodeCount"][Op.gte]).toBe(0);
    });
});
