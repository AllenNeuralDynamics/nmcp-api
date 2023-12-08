import {parentPort, workerData} from "worker_threads";

import {Tracing} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {SequelizeOptions} from "../options/coreServicesOptions";
import {mapTracingToCache} from "./tracingQueryMiddleware";

const debug = require("debug")("mnb:search-api:tracing-cache-worker");

export interface ITracingCacheWorkerInput {
    offset: number;
    limit: number;
}

parentPort.on("message", async (param: ITracingCacheWorkerInput) => {
    await RemoteDatabaseClient.Start(false, SequelizeOptions);

    const loaded = await Tracing.findAll({
        include: [{model: TracingNode, as: "Nodes"}],
        limit: param.limit,
        offset: param.offset
    });

    debug(`compiling tracings ${param.offset} through ${param.offset + param.limit - 1}`);

    const mapped = loaded.map((t) => mapTracingToCache(t));

    parentPort.postMessage(mapped);
})