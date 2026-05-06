import {ISearchMetricsStore} from "./searchMetricsStore";
import {SearchQueryMetrics, SearchPredicateMetrics} from "./searchMetricsTypes";
import {DebugMetricsStore} from "./debugMetricsStore";
import {InfluxDbMetricsStore} from "./influxDbMetricsStore";
import {InfluxDbOptions} from "../../options/coreServicesOptions";

const debug = require("debug")("nmcp:nmcp-api:search-metrics-service");

const stores: ISearchMetricsStore[] = [];

export function registerStore(store: ISearchMetricsStore): void {
    stores.push(store);
    debug("store registered: %s", store.constructor.name);
}

export function clearStores(): void {
    stores.length = 0;
}

export function recordSearchMetrics(query: SearchQueryMetrics, predicates: SearchPredicateMetrics[]): void {
    for (const store of stores) {
        store.recordSearchMetrics(query, predicates).catch((err) => {
            debug("store error: %s", err?.message ?? err);
        });
    }
}

registerStore(new DebugMetricsStore());

if (InfluxDbOptions.host && InfluxDbOptions.token) {
    registerStore(new InfluxDbMetricsStore(InfluxDbOptions));
    debug("influxdb store registered host=%s port=%d", InfluxDbOptions.host, InfluxDbOptions.port);
}
