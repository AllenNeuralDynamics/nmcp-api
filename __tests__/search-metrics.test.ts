import {expect, test, vi, beforeAll, beforeEach, afterEach, describe} from "vitest";

import {PredicateType, PredicateComposition, PredicateShape} from "../src/models/queryPredicate";
import {SearchContext} from "../src/models/searchContext";
import {SearchIndex} from "../src/models/searchIndex";
import {DebugMetricsStore} from "../src/data-access/searchMetrics/debugMetricsStore";
import {InfluxDbMetricsStore, InfluxDbOptions} from "../src/data-access/searchMetrics/influxDbMetricsStore";
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

// ──────────────────────────────────────────────────────────────
// InfluxDbMetricsStore
// ──────────────────────────────────────────────────────────────

describe("InfluxDbMetricsStore", () => {
    const defaultOptions: InfluxDbOptions = {
        host: "influx-host",
        port: 8086,
        token: "test-token-abc",
        org: "test-org",
        bucket: "test-bucket",
    };

    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn().mockResolvedValue({ok: true, status: 204});
        vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test("constructs correct v2 write URL", async () => {
        const store = new InfluxDbMetricsStore(defaultOptions);
        await store.recordSearchMetrics(makeQueryMetrics(), []);

        const callUrl = fetchSpy.mock.calls[0][0];
        expect(callUrl).toBe(
            "http://influx-host:8086/api/v2/write?org=test-org&bucket=test-bucket&precision=ns"
        );
    });

    test("sends Token authorization header", async () => {
        const store = new InfluxDbMetricsStore(defaultOptions);
        await store.recordSearchMetrics(makeQueryMetrics(), []);

        const callOptions = fetchSpy.mock.calls[0][1];
        expect(callOptions.headers["Authorization"]).toBe("Token test-token-abc");
    });

    test("sends line protocol body with search_query measurement", async () => {
        const timestamp = new Date("2025-01-15T12:00:00.000Z");
        const store = new InfluxDbMetricsStore(defaultOptions);

        await store.recordSearchMetrics(
            makeQueryMetrics({nonce: "abc123", timestamp, totalDurationMs: 42, predicateCount: 2, resultCount: 10}),
            []
        );

        const body: string = fetchSpy.mock.calls[0][1].body;
        expect(body).toContain("search_query,");
        expect(body).toContain("nonce=abc123");
        expect(body).toContain("status=ok");
        expect(body).toContain("totalDurationMs=42i");
        expect(body).toContain("predicateCount=2i");
        expect(body).toContain("resultCount=10i");

        const expectedNs = `${timestamp.getTime()}000000`;
        expect(body).toContain(expectedNs);
    });

    test("includes search_predicate lines for each predicate", async () => {
        const store = new InfluxDbMetricsStore(defaultOptions);

        await store.recordSearchMetrics(makeQueryMetrics(), [
            makePredicateMetrics({ordinal: 0, durationMs: 30}),
            makePredicateMetrics({ordinal: 1, durationMs: 70}),
        ]);

        const body: string = fetchSpy.mock.calls[0][1].body;
        const lines = body.split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[0]).toMatch(/^search_query,/);
        expect(lines[1]).toMatch(/^search_predicate,/);
        expect(lines[2]).toMatch(/^search_predicate,/);
        expect(lines[1]).toContain("durationMs=30i");
        expect(lines[2]).toContain("durationMs=70i");
    });

    test("throws on non-ok response", async () => {
        fetchSpy.mockResolvedValueOnce({ok: false, status: 401, text: async () => "Unauthorized"});

        const store = new InfluxDbMetricsStore(defaultOptions);

        await expect(
            store.recordSearchMetrics(makeQueryMetrics(), [])
        ).rejects.toThrow("InfluxDB write failed: 401 Unauthorized");
    });
});
