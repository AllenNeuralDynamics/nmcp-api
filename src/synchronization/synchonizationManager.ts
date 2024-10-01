import {fork} from "child_process";
import * as path from "path";

const debugWorker = require("debug")("mnb:synchronization:synchronization-worker");

import {addTracingToMiddlewareCacheById} from "../rawquery/tracingQueryMiddleware";
import {Reconstruction} from "../models/reconstruction";

/**
 * Start and manage a separate node process for synchronizing published reconstruction data.
 *
 * @remarks
 * This function will maintain and monitor a separate process for synchronizing newly published reconstructions, or published reconstructions whose upstream
 * dependencies, such as the parent neuron, who properties have changed.
 *
 * The function will start a process using <code>synchronizationWorker.ts</code> as the entry point.
 *
 * @see {performSynchronization}
 */
export function synchronizationManagerStart(){
    const proc = fork(path.join(__dirname, "synchronizationWorker"), [], {
        silent: true,
        execArgv: []
    });

    proc.stdout.on("data", data => {
        debugWorker(`${data.slice(0, -1)}`);
    });

    proc.stderr.on("data", data => {
        console.error(`${data.slice(0, -1)}`);
    });

    proc.on("exit", code => {
        debugWorker(`synchronization worker exit: ${code}`);

        if (code != 0) {
            setTimeout(() => {
                debugWorker(`restarting synchronization worker`);
                synchronizationManagerStart();
            }, 5000);
        }
    });

    proc.on("message", async (data: any)=> {
        // Must happen on the original process.
        await addTracingToMiddlewareCacheById(data);
        await Reconstruction.loadReconstructionCache();
    });
}
