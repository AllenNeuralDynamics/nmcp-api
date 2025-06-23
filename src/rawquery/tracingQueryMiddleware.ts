import * as path from "path";

import {ServiceOptions} from "../options/serviceOptions";
import {Tracing} from "../models/tracing";
import {StaticPool} from "node-worker-threads-pool";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {TracingNode} from "../models/tracingNode";
import {Reconstruction} from "../models/reconstruction";

const debug = require("debug")("mnb:search-db-api:raw-query");

const compiledMap = new Map<string, any>();

let timerStart;

export async function addTracingToMiddlewareCacheById(id: string) {
    if (!id) {
        return;
    }

    const tracing = await Tracing.findByPk(id, {
        include: [
            {
                model: TracingNode, as: "Nodes"
            },
            {
                model: Reconstruction,
                as: "Reconstruction",
                attributes: ["id", "status"],
                required: true
            }
        ]
    });

    if (tracing) {
        addTracingToMiddlewareCache(tracing);
    } else {
        debug(`failed to load expected tracing ${id} to compiled map`);
    }
}

export function removeTracingFromMiddlewareCache(ids: string[]) {
    if (ids) {
        ids.forEach((id) => {
            if (compiledMap.has(id)) {
                compiledMap.delete(id)
            }
        });
    }
}

export function addTracingToMiddlewareCache(tracing: Tracing) {
    if (!tracing) {
        return;
    }

    debug(`requested to add ${tracing.id} to compiled map (existing size ${compiledMap.size})`);
    const mappedTracing = mapTracingToCache(tracing);

    if (mappedTracing) {
        debug(`adding ${mappedTracing.id} to compiled map`);
        compiledMap.set(mappedTracing.id, mappedTracing)
    }
}

export function mapTracingToCache(t: Tracing): any {
    const obj = Object.assign({}, {id: t.id, nodes: []});

    if (t.Nodes) {
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
    } else {
        debug(`tracing ${t.id} does not have any nodes.`);
        return null;
    }

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

    compiledMap.clear()

    const totalCount = await Tracing.count({
        where: {
            "$Reconstruction.status$": ReconstructionStatus.Published
        },
        include: [
            {
                model: Reconstruction,
                as: "Reconstruction",
                attributes: ["id", "status"],
                required: true
            }
        ]
    });

    debug(`caching ${totalCount} reconstructions`);

    const pool = new StaticPool({
        size: 3,
        shareEnv: true,
        task: path.join(__dirname, "tracingCacheWorker.js")
    });

    timerStart = process.hrtime();

    for (let idx = 0; idx < totalCount; idx += ServiceOptions.tracingLoadLimit) {
        await (async () => {
            const res: any[] = await pool.exec({offset: idx, limit: ServiceOptions.tracingLoadLimit}) as any[];

            res.forEach(r => {
                compiledMap.set(r.id, r);
            });

            debug(`added ${res.length} to compiled map (size ${compiledMap.size})`);

            if (compiledMap.size == totalCount) {
                const hr_end = process.hrtime(timerStart);
                debug("tracing cache loaded");
                debug('execution time (hr): %ds %dms', hr_end[0], hr_end[1] / 1000000);
            }
        })();
        // debug(res);
    }
}

export async function tracingQueryMiddleware(req, res) {
    const ids: string[] = req.body.ids;

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

    await ids.reduce(async (promise: Promise<void>, id: string) => {
        await promise;

        if (!compiledMap.has(id)) {
            await addTracingToMiddlewareCacheById(id);
        }
    }, Promise.resolve());

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
