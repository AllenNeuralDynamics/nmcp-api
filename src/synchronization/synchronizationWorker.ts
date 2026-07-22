import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {QualityControl} from "../models/qualityControl";
import {User} from "../models/user";
import {SynchronizationWorkerNotification} from "./synchonizationManager";
import {ServiceBackoff} from "./serviceBackoff";

const debug = require("debug")("nmcp:synchronization:synchronization-worker");

const defaultBatchSize = 10;

const defaultIntervalSeconds = 60;
const qcBackoffBaseMs = defaultIntervalSeconds * 1000;   // 60s: first retry after one normal interval
const qcBackoffMaxMs = 5 * 60 * 1000;                    // cap at 5 minutes

const qcBackoff = new ServiceBackoff(qcBackoffBaseMs, qcBackoffMaxMs);

if (require.main === module) {
    setTimeout(async () => {
        debug("synchronization worker starting");

        await RemoteDatabaseClient.Start();

        await performSynchronization();

    }, 1000);
}

/**
 * Perform one pass of synchronizing published reconstruction data.
 *
 * @param repeat - `true` to call itself repeatedly as the specified interval (default `true`)
 * @param intervalSeconds - delay in seconds between successive calls when `repeat` is `true` (default `60`)
 */
async function performSynchronization(repeat: boolean = true, intervalSeconds = defaultIntervalSeconds) {
    let intervalStart = Date.now();

    // Would like to complete processing, where possible, in batches, rather than doing all QC, before moving on to the next step, etc.
    let mayBeMore = await performQualityControl(defaultBatchSize);

    mayBeMore = (await performStructureAssignments(defaultBatchSize)) || mayBeMore;

    mayBeMore = (await performSearchIndexing(defaultBatchSize)) || mayBeMore;

    // If the batch size was fulfilled for any of the steps, immediately (ok, 50ms) perform another loop.  Otherwise, wait whatever is left of the polling
    // interval.
    const delay = mayBeMore ? 50 : Math.max(0, (intervalSeconds * 1000 - (Date.now() - intervalStart)));

    if (repeat) {
        setTimeout(async () => {
            await performSynchronization(repeat, intervalSeconds);
        }, delay);
    }
}

// With default settings, this will give a heartbeat message that everything is published once per hour.
const sanityCheckInterval = 1;

let sanityQualityCheckPendingCount = sanityCheckInterval - 1;
let sanityStructureCheckCount = sanityCheckInterval - 1;
let sanitySearchContentsCheckCount = sanityCheckInterval - 1;

async function performQualityControl(batchSize: number): Promise<boolean> {
    if (!qcBackoff.ready(Date.now())) {
        // Backing off from an unavailable QC service; skip cheaply so the other
        // steps keep running without re-hammering the service or spamming logs.
        return false;
    }

    const pending = await QualityControl.getPending(batchSize);

    if (pending.length === 0) {
        sanityQualityCheckPendingCount++;

        if (sanityQualityCheckPendingCount >= sanityCheckInterval) {
            debug(`there are no reconstructions with quality control check pending`);
            sanityQualityCheckPendingCount = 0;
        }

        return false;
    }

    debug(`${pending.length} or more quality control calls are pending`);
    sanityQualityCheckPendingCount = 0;

    let processed = 0;

    for (const qc of pending) {
        // Success == service was available and called, not whether QC passed.
        const success = await qc.assess(User.SystemInternalUser);

        if (!success) {
            if (qcBackoff.recordFailure(Date.now())) {
                debug(`QC service unavailable - backing off, next attempt in ${qcBackoff.currentDelay}ms`);
            }

            return false;
        }

        processed++;
    }

    if (qcBackoff.recordSuccess()) {
        debug(`QC service recovered`);
    }

    return processed === batchSize;
}

async function performStructureAssignments(batchSize: number): Promise<boolean> {
    const pending = await AtlasReconstruction.getPendingStructureAssignment(batchSize);

    if (pending.length > 0) {
        debug(`${pending.length} or more reconstructions have node structure assignment pending`);

        for (let reconstruction of pending) {
            await reconstruction.calculateStructureAssignments(User.SystemInternalUser);
        }

        sanityStructureCheckCount = 0;

        return pending.length == batchSize;
    } else {
        sanityStructureCheckCount++;

        if (sanityStructureCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingStructureAssignment state`);
            sanityStructureCheckCount = 0;
        }
    }

    return false;
}

async function performSearchIndexing(batchSize: number): Promise<boolean> {
    const pending = await AtlasReconstruction.getIndexable(batchSize);

    if (pending.length > 0) {
        debug(`${pending.length} or more atlas reconstructions require indexing`);

        for (let reconstruction of pending) {
            await reconstruction.updateSearchIndex(User.SystemInternalUser);
        }

        // TODO Update a search index marker that the main process can check to update any caches.

        process.send(SynchronizationWorkerNotification.SearchIndexUpdated);

        sanitySearchContentsCheckCount = 0;

        return pending.length == batchSize;
    } else {
        sanitySearchContentsCheckCount++;

        if (sanitySearchContentsCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingSearchContents state`);
            sanitySearchContentsCheckCount = 0;
        }
    }

    return false;
}

export {performQualityControl, qcBackoff};
