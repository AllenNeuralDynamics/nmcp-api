import {ISearchMetricsStore} from "./searchMetricsStore";
import {SearchQueryMetrics, SearchPredicateMetrics} from "./searchMetricsTypes";
import {PredicateType, PredicateComposition} from "../../models/queryPredicate";

const debug = require("debug")("nmcp:nmcp-api:search-metrics-influxdb");

export interface InfluxDbOptions {
    host: string;
    port: number;
    token: string;
    org: string;
    bucket: string;
}

function escapeTag(value: string): string {
    return value.replace(/[,= \n]/g, (ch) => `\\${ch}`);
}

function escapeFieldString(value: string): string {
    return value.replace(/["\\]/g, (ch) => `\\${ch}`);
}

function predicateTypeName(type: PredicateType): string {
    return PredicateType[type] ?? String(type);
}

function compositionName(comp: PredicateComposition): string {
    return PredicateComposition[comp] ?? String(comp);
}

export class InfluxDbMetricsStore implements ISearchMetricsStore {
    private readonly writeUrl: string;
    private readonly authHeader: string;

    constructor(options: InfluxDbOptions) {
        this.writeUrl = `http://${options.host}:${options.port}/api/v2/write?org=${encodeURIComponent(options.org)}&bucket=${encodeURIComponent(options.bucket)}&precision=ns`;
        this.authHeader = `Token ${options.token}`;
    }

    async recordSearchMetrics(query: SearchQueryMetrics, predicates: SearchPredicateMetrics[]): Promise<void> {
        const timestampMs = query.timestamp.getTime();
        const timestampNs = `${timestampMs}000000`;
        const lines: string[] = [];

        const queryTags = [
            `nonce=${escapeTag(query.nonce)}`,
            `status=${query.error ? "error" : "ok"}`
        ];

        if (query.collectionIds.length > 0) {
            queryTags.push(`collections=${escapeTag(query.collectionIds.join(";"))}`);
        }

        const queryFields = [
            `totalDurationMs=${query.totalDurationMs}i`,
            `predicateCount=${query.predicateCount}i`,
            `resultCount=${query.resultCount}i`
        ];

        if (query.error) {
            queryFields.push(`error="${escapeFieldString(query.error)}"`);
        }

        lines.push(`search_query,${queryTags.join(",")} ${queryFields.join(",")} ${timestampNs}`);

        for (const predicate of predicates) {
            const predTags = [
                `nonce=${escapeTag(query.nonce)}`,
                `predicateType=${escapeTag(predicateTypeName(predicate.predicateType))}`,
                `composition=${escapeTag(compositionName(predicate.composition))}`
            ];

            const predFields = [
                `ordinal=${predicate.ordinal}i`,
                `durationMs=${predicate.durationMs}i`,
                `resultCountRaw=${predicate.resultCountRaw}i`,
                `resultCountAfterComposition=${predicate.resultCountAfterComposition}i`,
                `parameters="${escapeFieldString(JSON.stringify(predicate.parameters))}"`
            ];

            lines.push(`search_predicate,${predTags.join(",")} ${predFields.join(",")} ${timestampNs}`);
        }

        const body = lines.join("\n");

        const response = await fetch(this.writeUrl, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain",
                "Authorization": this.authHeader
            },
            body
        });

        if (!response.ok) {
            const text = await response.text();
            debug("write failed status=%d body=%s", response.status, text);
            throw new Error(`InfluxDB write failed: ${response.status} ${text}`);
        } else {
            debug("write succeeded status=%d", response.status);
        }
    }
}
