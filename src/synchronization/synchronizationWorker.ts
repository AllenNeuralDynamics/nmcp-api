import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {AtlasReconstructionStatus} from "../models/atlasReconstructionStatus";
import {QualityControl} from "../models/qualityControl";
import {User} from "../models/user";
import {SynchronizationWorkerNotification} from "./synchonizationManager";
import {ServiceBackoff} from "./serviceBackoff";
import {failureText, PhaseOutcome} from "../util/phaseFailure";

const debug = require("debug")("nmcp:synchronization:synchronization-worker");

const defaultBatchSize = 10;

const defaultIntervalSeconds = 60;
const qcBackoffBaseMs = defaultIntervalSeconds * 1000;   // 60s: first retry after one normal interval
const qcBackoffMaxMs = 5 * 60 * 1000;                    // cap at 5 minutes

const doiBackoffBaseMs = defaultIntervalSeconds * 1000;  // 60s: first retry after one normal interval
const doiBackoffMaxMs = 5 * 60 * 1000;                   // cap at 5 minutes

const qcBackoff = new ServiceBackoff(qcBackoffBaseMs, qcBackoffMaxMs);
const doiBackoff = new ServiceBackoff(doiBackoffBaseMs, doiBackoffMaxMs);

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
        try {
            await releaseAbandonedClaims();
        } catch (err) {
            // Contained like a phase, but not run through runPhase: the sweep has no "may be more work" answer to
            // give, and whatever it released is picked up by the phases that follow it in this same pass.
            debug(`claim recovery failed: ${failureText(err)}`);
        }

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
 * Returns claims no phase is holding, at every pass boundary rather than only at startup.  A release written from a
 * per-item catch can fail for the same reason the failure record it follows failed, and the manager restarts this
 * worker only on a non-zero exit - a contained throw is not one - so without this an item could sit at an In...
 * status, unselectable and unretryable, until the next deploy.  Safe here because the four phases are awaited in
 * sequence: at a pass boundary nothing is legitimately claimed.
 */
async function releaseAbandonedClaims(): Promise<void> {
    const children = await AtlasReconstruction.releasePhaseClaims();
    const qualityControl = await QualityControl.releasePhaseClaims();

    if (children > 0 || qualityControl > 0) {
        debug(`released ${children} abandoned atlas reconstruction claim(s) and ${qualityControl} quality control claim(s)`);
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
        let outcome: PhaseOutcome;

        try {
            // Inside the try, not above it: a claim that fails on a database transient should cost this item rather
            // than escape to runPhase, which abandons the whole phase for the pass.
            if (!(await qc.claim())) {
                // Another pass or another instance took it; not this pass's item and not a failure.
                continue;
            }

            outcome = await qc.assess(User.SystemInternalUser);
        } catch (err) {
            debug(`quality control threw for ${qc.id}: ${failureText(err)}`);

            // assess classifies and records its own failures, so a throw here is the failure write failing.  Hand
            // the claim back immediately; if this write fails too the sweep at the top of the next pass is what
            // guarantees the row does not stay claimed.  Guarded so it cannot replace the error above.
            try {
                await qc.release();
            } catch (releaseError) {
                debug(`could not release the claim on ${qc.id}: ${failureText(releaseError)}`);
            }

            continue;
        }

        if (outcome === PhaseOutcome.ServiceUnavailable) {
            if (qcBackoff.recordFailure(Date.now())) {
                debug(`QC service unavailable - backing off, next attempt in ${qcBackoff.currentDelay}ms`);
            }

            // Abandoning the rest of the batch is right - the service is a container beside this one, so unavailable
            // means a restart, not a hiccup - but the pass still has work outstanding.  Reporting it drives the
            // immediate next cycle, where the backoff skips quality control and the other phases run against statuses
            // that may since have moved.  It cannot loop: qcBackoff.ready() is false for at least 60 seconds.
            return true;
        }

        if (outcome === PhaseOutcome.Released) {
            // A database transient, not a service outage.  The claim is back; do not touch the backoff, and do not
            // count it as processed - the next pass picks the item up.
            continue;
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
                if (!(await reconstruction.claim(AtlasReconstructionStatus.PendingStructureAssignment, AtlasReconstructionStatus.InStructureAssignment))) {
                    continue;
                }

                // Released means the phase handed the claim back on a database transient; it is not a processed item.
                if (await reconstruction.calculateStructureAssignments(User.SystemInternalUser) === PhaseOutcome.Handled) {
                    processed++;
                }
            } catch (err) {
                debug(`structure assignment threw for ${reconstruction.id}: ${failureText(err)}`);

                try {
                    await reconstruction.release(AtlasReconstructionStatus.InStructureAssignment, AtlasReconstructionStatus.PendingStructureAssignment);
                } catch (releaseError) {
                    debug(`could not release the claim on ${reconstruction.id}: ${failureText(releaseError)}`);
                }
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
        let outcome: PhaseOutcome;

        try {
            if (!(await reconstruction.claim(AtlasReconstructionStatus.PendingDoiAssignment, AtlasReconstructionStatus.InDoiAssignment))) {
                continue;
            }

            // Handled == the item was dealt with, not that the DOIs were registered: a rejection is recorded on the
            // child as FailedDoiAssignment by the phase itself.
            outcome = await reconstruction.assignDois(User.SystemInternalUser);
        } catch (err) {
            debug(`doi assignment threw for ${reconstruction.id}: ${failureText(err)}`);

            try {
                await reconstruction.release(AtlasReconstructionStatus.InDoiAssignment, AtlasReconstructionStatus.PendingDoiAssignment);
            } catch (releaseError) {
                debug(`could not release the claim on ${reconstruction.id}: ${failureText(releaseError)}`);
            }

            continue;
        }

        if (outcome === PhaseOutcome.ServiceUnavailable) {
            if (doiBackoff.recordFailure(Date.now())) {
                debug(`DOI service unavailable - backing off, next attempt in ${doiBackoff.currentDelay}ms`);
            }

            // As with quality control: abandon the rest of the batch but report the work as outstanding, so the next
            // cycle runs the other phases immediately while the backoff holds this one off.
            return true;
        }

        if (outcome === PhaseOutcome.Released) {
            continue;
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
                if (!(await reconstruction.claim(AtlasReconstructionStatus.PendingSearchIndexing, AtlasReconstructionStatus.InSearchIndexing))) {
                    continue;
                }

                if (await reconstruction.updateSearchIndex(User.SystemInternalUser) === PhaseOutcome.Handled) {
                    processed++;
                }
            } catch (err) {
                debug(`search indexing threw for ${reconstruction.id}: ${failureText(err)}`);

                try {
                    await reconstruction.release(AtlasReconstructionStatus.InSearchIndexing, AtlasReconstructionStatus.PendingSearchIndexing);
                } catch (releaseError) {
                    debug(`could not release the claim on ${reconstruction.id}: ${failureText(releaseError)}`);
                }
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

export {
    performSynchronization,
    performQualityControl,
    performStructureAssignments,
    performDoiAssignment,
    performSearchIndexing,
    releaseAbandonedClaims,
    qcBackoff,
    doiBackoff
};
