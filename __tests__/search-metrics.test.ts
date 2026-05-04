import {expect, test, vi, beforeAll, beforeEach, afterEach, describe} from "vitest";

import {PredicateType, PredicateComposition, PredicateShape} from "../src/models/queryPredicate";
import {SearchContext} from "../src/models/searchContext";
import {SearchIndex} from "../src/models/searchIndex";
import {DebugMetricsStore} from "../src/data-access/searchMetrics/debugMetricsStore";
import {SearchQueryMetrics, SearchPredicateMetrics} from "../src/data-access/searchMetrics/searchMetricsTypes";
import {ISearchMetricsStore} from "../src/data-access/searchMetrics/searchMetricsStore";

let metricsService: typeof import("../src/data-access/searchMetrics/searchMetricsService");

beforeAll(() => {
    metricsService = require("../src/data-access/searchMetrics/searchMetricsService");
});

function makeQueryMetrics(overrides: Partial<SearchQueryMetrics> = {}): SearchQueryMetrics {
    return {
        nonce: "test-nonce",
        timestamp: new Date(),
        totalDurationMs: 100,
        predicateCount: 1,
        resultCount: 5,
        collectionIds: [],
        error: null,
        ...overrides,
    };
}

function makePredicateMetrics(overrides: Partial<SearchPredicateMetrics> = {}): SearchPredicateMetrics {
    return {
        ordinal: 0,
        predicateType: PredicateType.AnatomicalRegion,
        composition: PredicateComposition.or,
        durationMs: 50,
        resultCountRaw: 10,
        resultCountAfterComposition: 5,
        parameters: {},
        ...overrides,
    };
}

function makeIdOrDoiShape(composition: PredicateComposition): PredicateShape {
    return {
        predicateType: PredicateType.IdOrDoi,
        composition,
        idOrDoiPredicate: {labelOrDoiExactMatch: true, labelsOrDois: ["placeholder"]},
    };
}

function mockSearchIndexEntry(neuronId: string) {
    return {id: `si-${neuronId}`, neuronId, somaX: 0, somaY: 0, somaZ: 0};
}

// ──────────────────────────────────────────────────────────────
// searchMetricsService
// ──────────────────────────────────────────────────────────────

describe("searchMetricsService", () => {
    beforeEach(() => {
        metricsService.clearStores();
    });

    test("registerStore adds a store that receives metrics", async () => {
        const received: {query: SearchQueryMetrics; predicates: SearchPredicateMetrics[]}[] = [];

        const store: ISearchMetricsStore = {
            async recordSearchMetrics(query, predicates) {
                received.push({query, predicates});
            },
        };

        metricsService.registerStore(store);

        const query = makeQueryMetrics();
        const predicates = [makePredicateMetrics()];

        metricsService.recordSearchMetrics(query, predicates);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(received).toHaveLength(1);
        expect(received[0].query).toBe(query);
        expect(received[0].predicates).toBe(predicates);
    });

    test("fans out to multiple registered stores", async () => {
        let countA = 0;
        let countB = 0;

        const storeA: ISearchMetricsStore = {
            async recordSearchMetrics() { countA++; },
        };
        const storeB: ISearchMetricsStore = {
            async recordSearchMetrics() { countB++; },
        };

        metricsService.registerStore(storeA);
        metricsService.registerStore(storeB);

        metricsService.recordSearchMetrics(makeQueryMetrics(), [makePredicateMetrics()]);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(countA).toBe(1);
        expect(countB).toBe(1);
    });

    test("error in one store does not affect others", async () => {
        let called = false;

        const failingStore: ISearchMetricsStore = {
            async recordSearchMetrics() { throw new Error("store failure"); },
        };
        const workingStore: ISearchMetricsStore = {
            async recordSearchMetrics() { called = true; },
        };

        metricsService.registerStore(failingStore);
        metricsService.registerStore(workingStore);

        metricsService.recordSearchMetrics(makeQueryMetrics(), [makePredicateMetrics()]);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(called).toBe(true);
    });

    test("clearStores removes all stores", async () => {
        let called = false;

        const store: ISearchMetricsStore = {
            async recordSearchMetrics() { called = true; },
        };

        metricsService.registerStore(store);
        metricsService.clearStores();

        metricsService.recordSearchMetrics(makeQueryMetrics(), [makePredicateMetrics()]);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(called).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────
// DebugMetricsStore
// ──────────────────────────────────────────────────────────────

describe("DebugMetricsStore", () => {
    test("recordSearchMetrics resolves without throwing", async () => {
        const store = new DebugMetricsStore();

        await expect(
            store.recordSearchMetrics(makeQueryMetrics(), [makePredicateMetrics()])
        ).resolves.toBeUndefined();
    });

    test("handles empty predicates array", async () => {
        const store = new DebugMetricsStore();

        await expect(
            store.recordSearchMetrics(makeQueryMetrics(), [])
        ).resolves.toBeUndefined();
    });

    test("handles error query metrics", async () => {
        const store = new DebugMetricsStore();

        await expect(
            store.recordSearchMetrics(makeQueryMetrics({error: "test error"}), [makePredicateMetrics()])
        ).resolves.toBeUndefined();
    });
});

// ──────────────────────────────────────────────────────────────
// performNeuronsFilterQuery returns FilterQueryResult
// ──────────────────────────────────────────────────────────────

describe("performNeuronsFilterQuery returns FilterQueryResult", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("returns FilterQueryResult structure with predicateResults", async () => {
        vi.spyOn(SearchIndex, "findAll").mockResolvedValueOnce([
            mockSearchIndexEntry("N1"),
            mockSearchIndexEntry("N2"),
        ] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [makeIdOrDoiShape(PredicateComposition.or)],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result).toHaveProperty("neuronIds");
        expect(result).toHaveProperty("predicateResults");
        expect(result.predicateResults).toHaveLength(1);
        expect(result.predicateResults[0]).toHaveProperty("durationMs");
        expect(result.predicateResults[0]).toHaveProperty("rawNeuronIds");
        expect(result.predicateResults[0]).toHaveProperty("composedNeuronIds");
    });

    test("per-predicate durationMs is non-negative", async () => {
        vi.spyOn(SearchIndex, "findAll").mockResolvedValueOnce([
            mockSearchIndexEntry("N1"),
        ] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [makeIdOrDoiShape(PredicateComposition.or)],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.predicateResults[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    test("multi-predicate AND shows narrowing in composedNeuronIds", async () => {
        vi.spyOn(SearchIndex, "findAll")
            .mockResolvedValueOnce([
                mockSearchIndexEntry("N1"),
                mockSearchIndexEntry("N2"),
                mockSearchIndexEntry("N3"),
            ] as any)
            .mockResolvedValueOnce([
                mockSearchIndexEntry("N2"),
                mockSearchIndexEntry("N3"),
            ] as any);

        const context = new SearchContext({
            nonce: "test",
            collectionIds: [],
            predicates: [
                makeIdOrDoiShape(PredicateComposition.or),
                makeIdOrDoiShape(PredicateComposition.and),
            ],
        });

        const result = await SearchIndex.performNeuronsFilterQuery(context);

        expect(result.predicateResults[0].rawNeuronIds.sort()).toEqual(["N1", "N2", "N3"]);
        expect(result.predicateResults[0].composedNeuronIds.sort()).toEqual(["N1", "N2", "N3"]);

        expect(result.predicateResults[1].rawNeuronIds.sort()).toEqual(["N2", "N3"]);
        expect(result.predicateResults[1].composedNeuronIds.sort()).toEqual(["N2", "N3"]);

        expect(result.neuronIds.sort()).toEqual(["N2", "N3"]);
    });
});
