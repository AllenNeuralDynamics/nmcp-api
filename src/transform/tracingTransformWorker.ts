const debug = require("debug")("mnb:transform:node-worker");

import {BrainArea} from "../models/brainArea";
import {ITransformOperationProgress, TransformOperation} from "./tracingTransformOperation";
import {Tracing} from "../models/tracing";

export async function performNodeMap(tracing: Tracing, isFork: boolean = false): Promise<Tracing> {
    const brainIdLookup = new Map<number, BrainArea>();

    if (!tracing) {
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
            tracing: tracing,
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
