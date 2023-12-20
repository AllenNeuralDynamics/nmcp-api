import * as path from "path";

import {ServiceOptions} from "../options/serviceOptions";
import {Tracing} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {StaticPool} from "node-worker-threads-pool";

const debug = require("debug")("mnb:search-db-api:raw-query");

const compiledMap = new Map<string, any>();

let cacheReady = false;

let timerStart;

export function addTracingToMiddlewareCache(tracing: Tracing) {
    const mappedTracing = mapTracingToCache(tracing);

    compiledMap.set(mappedTracing.id, mappedTracing)
}

export function mapTracingToCache(t: Tracing): any {
    const obj = Object.assign({}, {id: t.id, nodes: []});

    obj.nodes = t.Nodes.map(n => Object.assign({}, {
        id: n.id,
        x: n.x,
        y: n.y,
        z: n.z,
        radius: n.radius,
        parentNumber: n.parentNumber,
        sampleNumber: n.sampleNumber,
        brainStructureId: n.brainStructureId,
        structureIdentifierId: n.structureIdentifierId
    }));

    return obj;
}

export async function loadTracingCache(performDelay = true) {
    if (performDelay) {
        const delay = Math.random() * ServiceOptions.tracingLoadMaxDelay;

        debug(`delaying ${delay.toFixed(0)} seconds before initiating cache load`);

        setTimeout(async () => {
            await loadTracingCache(false)
        }, delay * 1000);

        return;
    }

    debug("loading cache");

    const totalCount = await Tracing.count();

    const pool = new StaticPool({
        size: 3,
        shareEnv: true,
        task: path.join(__dirname, "tracingCacheWorker.js")
    });

    timerStart = process.hrtime();

    for (let idx = 0; idx < totalCount; idx += ServiceOptions.tracingLoadLimit) {
        (async () => {
            const res: any[] = await pool.exec({offset: idx, limit: ServiceOptions.tracingLoadLimit}) as any[];

            res.forEach(r => compiledMap.set(r.id, r));

            if (compiledMap.size == totalCount) {
                const hrend = process.hrtime(timerStart);
                debug("tracing cache loaded");
                debug('execution time (hr): %ds %dms', hrend[0], hrend[1] / 1000000);
            }
        })();
        // debug(res);
    }
}

export async function tracingQueryMiddleware(req, res) {
    const ids = req.body.ids;

    if (!ids || ids.length === 0) {
        res.json({
            tracings: [],
            timing: {
                sent: Date.now().valueOf(),
                total: 0,
                load: 0,
                map: 0
            }
        });

        return;
    }

    try {
        res.json({
            tracings: ids.map(id => compiledMap.get(id)),
            timing: {
                sent: Date.now().valueOf(),
                total: 0,
                load: 0,
                map: 0
            }
        });
    } catch (err) {
        console.log(err);
        res.json({
            tracings: [],
            timing: {
                sent: Date.now().valueOf(),
                total: 0,
                load: 0,
                map: 0
            }
        });
    }
}
