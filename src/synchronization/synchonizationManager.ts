import {fork} from "child_process";
import * as path from "path";

const debugWorker = require("debug")("nmcp:synchronization:synchronization-worker");

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
        execArgv: [],
        stdio: [
            /* stdin: */ 0,
            /* stdout: */ "pipe",
            /* stderr: */ "pipe",
            "ipc"
        ],
        env: Object.assign({}, process.env, {
            DEBUG_COLORS: 1
        }),
    });

    proc.stderr.pipe(process.stderr, { end: false });

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
        // Must happen on the original process.  data should be the id of a reconstruction.
        await Reconstruction.loadReconstructionCache(data);
    });
}
