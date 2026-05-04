import {PredicateType, PredicateComposition} from "../../models/queryPredicate";

export interface SearchQueryMetrics {
    nonce: string;
    timestamp: Date;
    totalDurationMs: number;
    predicateCount: number;
    resultCount: number;
    collectionIds: string[];
    error: string | null;
}

export interface SearchPredicateMetrics {
    ordinal: number;
    predicateType: PredicateType;
    composition: PredicateComposition;
    durationMs: number;
    resultCountRaw: number;
    resultCountAfterComposition: number;
    parameters: Record<string, unknown>;
}
