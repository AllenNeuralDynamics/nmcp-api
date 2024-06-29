import {parentPort} from "worker_threads";

import {Tracing} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {mapTracingToCache} from "./tracingQueryMiddleware";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";

const debug = require("debug")("mnb:search-api:tracing-cache-worker");

export interface ITracingCacheWorkerInput {
    offset: number;
    limit: number;
}

parentPort.on("message", async (param: ITracingCacheWorkerInput) => {
    await RemoteDatabaseClient.Start();

    const loaded = await Tracing.findAll({
        where: {
            "$Reconstruction.status$": ReconstructionStatus.Complete
        },
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
        ],
        limit: param.limit,
        offset: param.offset
    });

    debug(`compiling tracings ${param.offset} through ${param.offset + param.limit - 1}`);

    const mapped = loaded.map((t) => mapTracingToCache(t));

    parentPort.postMessage(mapped);
})
