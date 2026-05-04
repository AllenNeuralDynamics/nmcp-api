import {ISearchMetricsStore} from "./searchMetricsStore";
import {SearchQueryMetrics, SearchPredicateMetrics} from "./searchMetricsTypes";

const debug = require("debug")("nmcp:nmcp-api:search-metrics");

export class DebugMetricsStore implements ISearchMetricsStore {
    async recordSearchMetrics(query: SearchQueryMetrics, predicates: SearchPredicateMetrics[]): Promise<void> {
        debug(
            "query nonce=%s status=%s duration=%dms predicates=%d results=%d collections=%s",
            query.nonce,
            query.error ? "error" : "ok",
            query.totalDurationMs,
            query.predicateCount,
            query.resultCount,
            query.collectionIds.join(",") || "(all)"
        );

        for (const predicate of predicates) {
            debug(
                "  predicate #%d composition=%d type=%d duration=%dms raw=%d composed=%d params=%s",
                predicate.ordinal,
                predicate.composition,
                predicate.predicateType,
                predicate.durationMs,
                predicate.resultCountRaw,
                predicate.resultCountAfterComposition,
                JSON.stringify(predicate.parameters)
            );
        }
    }
}
