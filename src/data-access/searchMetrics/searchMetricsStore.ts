import {SearchQueryMetrics, SearchPredicateMetrics} from "./searchMetricsTypes";

export interface ISearchMetricsStore {
    recordSearchMetrics(query: SearchQueryMetrics, predicates: SearchPredicateMetrics[]): Promise<void>;
}
