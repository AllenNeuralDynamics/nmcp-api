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

const doiBackoffBaseMs = defaultIntervalSeconds * 1000;  // 60s: first retry after one normal interval
const doiBackoffMaxMs = 5 * 60 * 1000;                   // cap at 5 minutes

const qcBackoff = new ServiceBackoff(qcBackoffBaseMs, qcBackoffMaxMs);
const doiBackoff = new ServiceBackoff(doiBackoffBaseMs, doiBackoffMaxMs);

function failureText(err: unknown): string {
    return err instanceof Error ? err.stack ?? err.message : String(err);
}

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
    const intervalStart = Date.now();

    let mayBeMore = false;

    try {
        // Would like to complete processing, where possible, in batches, rather than doing all QC, before moving on to the next step, etc.
        mayBeMore = await runPhase("quality control", () => performQualityControl(defaultBatchSize));

        mayBeMore = (await runPhase("structure assignment", () => performStructureAssignments(defaultBatchSize))) || mayBeMore;

        mayBeMore = (await runPhase("doi assignment", () => performDoiAssignment(defaultBatchSize))) || mayBeMore;

        mayBeMore = (await runPhase("search indexing", () => performSearchIndexing(defaultBatchSize))) || mayBeMore;
    } finally {
        // If the batch size was fulfilled for any of the steps, immediately (ok, 50ms) perform another loop.  Otherwise, wait whatever is left of the polling
        // interval.
        const delay = mayBeMore ? 50 : Math.max(0, (intervalSeconds * 1000 - (Date.now() - intervalStart)));

        if (repeat) {
            // In a finally, and with the recursive call's rejection caught: an unhandled rejection inside a setTimeout
            // callback terminates the worker, the manager restarts it onto the same row, and the pipeline crash-loops.
            setTimeout(() => {
                performSynchronization(repeat, intervalSeconds).catch(err => debug(`synchronization pass failed: ${failureText(err)}`));
            }, delay);
        }
    }
}

/**
 * Runs one phase in isolation.  A phase that throws is reported as "no more work" so the remaining phases still run
 * this pass; whatever it did not reach keeps its current status and is picked up on the next one.
 */
async function runPhase(name: string, phase: () => Promise<boolean>): Promise<boolean> {
    try {
        return await phase();
    } catch (err) {
        debug(`${name} phase failed: ${failureText(err)}`);
        return false;
    }
}

// With default settings, this will give a heartbeat message that everything is published once per hour.
const sanityCheckInterval = 1;

let sanityQualityCheckPendingCount = sanityCheckInterval - 1;
let sanityStructureCheckCount = sanityCheckInterval - 1;
let sanityDoiCheckCount = sanityCheckInterval - 1;
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
        let success: boolean;

        try {
            // Success == service was available and called, not whether QC passed.
            success = await qc.assess(User.SystemInternalUser);
        } catch (err) {
            debug(`quality control threw for ${qc.id}: ${failureText(err)}`);
            continue;
        }

        if (!success) {
            if (qcBackoff.recordFailure(Date.now())) {
                debug(`QC service unavailable - backing off, next attempt in ${qcBackoff.currentDelay}ms`);
            }

            // Abandoning the rest of the batch is right - the service is a container beside this one, so unavailable
            // means a restart, not a hiccup - but the pass still has work outstanding.  Reporting it drives the
            // immediate next cycle, where the backoff skips quality control and the other phases run against statuses
            // that may since have moved.  It cannot loop: qcBackoff.ready() is false for at least 60 seconds.
            return true;
        }

        processed++;
    }

    // Guarded on processed: a batch in which every item threw is not evidence the service recovered.
    if (processed > 0 && qcBackoff.recordSuccess()) {
        debug(`QC service recovered`);
    }

    return processed === batchSize;
}

async function performStructureAssignments(batchSize: number): Promise<boolean> {
    const pending = await AtlasReconstruction.getPendingStructureAssignment(batchSize);

    if (pending.length > 0) {
        debug(`${pending.length} or more reconstructions have node structure assignment pending`);

        let processed = 0;

        for (let reconstruction of pending) {
            try {
                await reconstruction.calculateStructureAssignments(User.SystemInternalUser);
                processed++;
            } catch (err) {
                debug(`structure assignment threw for ${reconstruction.id}: ${failureText(err)}`);
            }
        }

        sanityStructureCheckCount = 0;

        // Successes, not selections: a batch that fails outright must not drive the 50ms fast loop.
        return processed == batchSize;
    } else {
        sanityStructureCheckCount++;

        if (sanityStructureCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingStructureAssignment state`);
            sanityStructureCheckCount = 0;
        }
    }

    return false;
}

async function performDoiAssignment(batchSize: number): Promise<boolean> {
    if (!doiBackoff.ready(Date.now())) {
        // Backing off from an unavailable DataCite; skip cheaply so the other steps keep running.
        return false;
    }

    const pending = await AtlasReconstruction.getPendingDoiAssignment(batchSize);

    if (pending.length === 0) {
        sanityDoiCheckCount++;

        if (sanityDoiCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions with DOI assignment pending`);
            sanityDoiCheckCount = 0;
        }

        return false;
    }

    debug(`${pending.length} or more reconstructions have DOI assignment pending`);
    sanityDoiCheckCount = 0;

    let processed = 0;

    for (const reconstruction of pending) {
        let available: boolean;

        try {
            // Available == the service answered, not whether the DOIs were registered: a rejection is recorded on the
            // child as FailedDoiAssignment by the phase itself.
            available = await reconstruction.assignDois(User.SystemInternalUser);
        } catch (err) {
            debug(`doi assignment threw for ${reconstruction.id}: ${failureText(err)}`);
            continue;
        }

        if (!available) {
            if (doiBackoff.recordFailure(Date.now())) {
                debug(`DOI service unavailable - backing off, next attempt in ${doiBackoff.currentDelay}ms`);
            }

            // As with quality control: abandon the rest of the batch but report the work as outstanding, so the next
            // cycle runs the other phases immediately while the backoff holds this one off.
            return true;
        }

        processed++;
    }

    // Guarded on processed: a batch in which every item threw is not evidence the service recovered.
    if (processed > 0 && doiBackoff.recordSuccess()) {
        debug(`DOI service recovered`);
    }

    return processed === batchSize;
}

async function performSearchIndexing(batchSize: number): Promise<boolean> {
    const pending = await AtlasReconstruction.getIndexable(batchSize);

    if (pending.length > 0) {
        debug(`${pending.length} or more atlas reconstructions require indexing`);

        let processed = 0;

        for (let reconstruction of pending) {
            try {
                await reconstruction.updateSearchIndex(User.SystemInternalUser);
                processed++;
            } catch (err) {
                debug(`search indexing threw for ${reconstruction.id}: ${failureText(err)}`);
            }
        }

        // TODO Update a search index marker that the main process can check to update any caches.

        if (processed > 0) {
            // Optional call: the worker is normally forked and has an IPC channel, but it is also required directly,
            // where process.send does not exist.
            process.send?.(SynchronizationWorkerNotification.SearchIndexUpdated);
        }

        sanitySearchContentsCheckCount = 0;

        return processed == batchSize;
    } else {
        sanitySearchContentsCheckCount++;

        if (sanitySearchContentsCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingSearchContents state`);
            sanitySearchContentsCheckCount = 0;
        }
    }

    return false;
}

export {performSynchronization, performQualityControl, performStructureAssignments, performDoiAssignment, performSearchIndexing, qcBackoff, doiBackoff};
