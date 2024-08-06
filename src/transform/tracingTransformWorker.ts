const debug = require("debug")("mnb:transform:node-worker");

import {BrainArea} from "../models/brainArea";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {ITransformOperationProgress, TransformOperation} from "./tracingTransformOperation";
import {Tracing} from "../models/tracing";

let swcTracingId = process.argv.length > 2 ? process.argv[2] : null;

if (swcTracingId) {
    setTimeout(async () => {
        try {
            await RemoteDatabaseClient.Start();

            const swcTracing = await Tracing.findOneForTransform(swcTracingId);

            const result = await performNodeMap(swcTracing, true);

            if (result) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        } catch (err) {
            console.error(err);
            process.exit(2);
        }
    }, 0)
}

export async function performNodeMap(swcTracing: Tracing, isFork: boolean = false): Promise<Tracing> {
    const brainIdLookup = new Map<number, BrainArea>();

    if (!swcTracing) {
        logError("SWC input tracing is null");
        return null;
    }

    if (brainIdLookup.size === 0) {
        logMessage("populating brain area id lookup");
        const brainAreas = await
            BrainArea.findAll();

        brainAreas.forEach(brainArea => {
            brainIdLookup.set(brainArea.structureId, brainArea);
        });
    }

    try {
        const operation = new TransformOperation({
            compartmentMap: brainIdLookup,
            swcTracing,
            logger: logMessage,
            progressDelegate: onProgressMessage
        });

        await operation.processTracing();

        return operation.Tracing;
    } catch (err) {
        logError("transform exception");
        logError(err.toString());
    }

    return null;

    function logMessage(str: any) {
        if (isFork) {
            console.log(str);
        } else {
            debug(str);
        }
    }

    function logError(str: any) {
        if (isFork) {
            console.error(str);
        } else {
            debug(str);
        }
    }

    function onProgressMessage(message: ITransformOperationProgress) {
        if (isFork) {
            process.send(message);
        }
    }
}
