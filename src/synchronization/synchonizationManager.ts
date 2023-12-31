const debugWorker = require("debug")("mnb:synchronization:synchronization-worker");

import {fork} from "child_process";
import * as path from "path";

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

    proc.on("message", (data: any)=> {
        debugWorker(`${data.slice(0, -1)}`);
    });
}