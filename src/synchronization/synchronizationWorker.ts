import {Op} from "sequelize";

import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Neuron} from "../models/neuron";
import {Tracing} from "../models/tracing";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {SynchronizationMarker, SynchronizationMarkerKind} from "../models/synchronizationMarker";
import {Precomputed} from "../models/precomputed";
import {AtlasStructure} from "../models/atlasStructure";

const debug = require("debug")("nmcp:synchronization:synchronization-worker");

setTimeout(async () => {
    debug("synchronization worker starting");

    await RemoteDatabaseClient.Start();

    await AtlasStructure.loadCompartmentCache("synchronization process");

    await performSynchronization();

}, 1000);

/**
 * Perform one pass of synchronizing published reconstruction data.
 *
 * @param repeat - `true` to call itself repeatedly as the specified interval (default `true`)
 * @param intervalSeconds - delay in seconds between successive calls when `repeat` is `true` (default `60`)
 */
async function performSynchronization(repeat: boolean = true, intervalSeconds = 60) {
    await invalidateUpdatedNeurons();

    await calculateStructureAssignments();

    await calculateSearchContents();

    await notifyPrecomputed();

    await checkPrecomputedComplete();

    await qualityCheckPendingWorker();

    if (repeat) {
        setTimeout(async () => {
            await performSynchronization(repeat, intervalSeconds);
        }, intervalSeconds * 1000);
    }
}

function reloadReconstructionCache(ids: string[]) {
    if (ids) {
        process.send(ids);
    }
}

/**
 * Find neurons with published reconstructions that have been updated since the last time we checked.  These need their derived SearchContents
 * updated if one of the property changes is relevant.
 *
 * @remarks Currently implemented for any property change, even ones that do not have downstream SearchContents implications.
 */
async function invalidateUpdatedNeurons() {
    const when = Date.now();

    let lastMarker = await SynchronizationMarker.lastMarker(SynchronizationMarkerKind.Neuron);

    const options = {
        where: {
            "$Reconstructions.status$": ReconstructionStatus.Published
        },
        include: [
            {
                model: Reconstruction,
                as: "Reconstructions",
                attributes: ["id", "status"],
                required: true
            }
        ]
    };

    if (lastMarker == null) {
        lastMarker = await SynchronizationMarker.create({markerKind: SynchronizationMarkerKind.Neuron});
    } else {
        options.where["updatedAt"] = {[Op.gt]: lastMarker.updatedAt};
    }

    const neurons = await Neuron.findAll(options);

    if (neurons.length > 0) {
        debug(`${neurons.length} neuron(s) with a published reconstruction updated since last synchronization`);

        const updates: string[] = [];

        for (let n of neurons) {
            const tracings = await Tracing.getForNeuron(n.id);

            debug(`\t${tracings.length} tracings for neuron ${n.id}`);

            const tracingPromises = tracings.map(async (t) => {
                await t.update({nodeLookupAt: null, searchTransformAt: null});

                const reconstruction = await t.getReconstruction();

                if (reconstruction) {
                    await reconstruction.update({status: ReconstructionStatus.PendingStructureAssignment});

                    updates.push(reconstruction.id);
                }
            });

            await Promise.all(tracingPromises);
        }

        reloadReconstructionCache(updates);
    }

    await lastMarker.update({appliedAt: when});
}

// With default settings, this will give a heartbeat message that everything is published once per hour.
const sanityCheckInterval = 60;
// sanityCheckInterval - 1 => Will get a status update in the log on service start.
let sanityStructureCheckCount = sanityCheckInterval - 1;
let sanitySearchContentsCheckCount = sanityCheckInterval - 1;
let sanityNotifyPrecomputedCheckCount = sanityCheckInterval - 1;
let sanityCompletedPrecomputedCheckCount = sanityCheckInterval - 1;
let sanityQualityCheckPendingCount = sanityCheckInterval - 1;

async function calculateStructureAssignments() {
    const pending = await Reconstruction.getPublishPending(ReconstructionStatus.PendingStructureAssignment, 10);

    if (pending.length > 0) {
        debug(`${pending.length} reconstructions have node brain structure assignment pending`);

        const updates: string[] = [];

        for (let reconstruction of pending) {
            for (let tracing of reconstruction.Tracings) {
                if (tracing.nodeLookupAt == null) {
                    debug(`\tassigning node brain structures for ${tracing.id}`);

                    await Tracing.calculateStructureAssignments(tracing.id);
                }
            }

            await reconstruction.update({status: ReconstructionStatus.PendingSearchContents});

            updates.push(reconstruction.id);
        }

        reloadReconstructionCache(updates);

        sanityStructureCheckCount = 0;
    } else {
        sanityStructureCheckCount++;

        if (sanityStructureCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingStructureAssignment state`);
            sanityStructureCheckCount = 0;
        }
    }
}

/**
 * Find recently uploaded tracings for published reconstructions that require node brain structure lookup and search content entries.
 */
async function calculateSearchContents() {
    const pending = await Reconstruction.getPublishPending(ReconstructionStatus.PendingSearchContents, 10);

    if (pending.length > 0) {
        debug(`${pending.length} reconstructions have SearchContents pending`);

        const updates: string[] = [];

        for (let reconstruction of pending) {
            for (let tracing of reconstruction.Tracings) {
                if (tracing.searchTransformAt == null) {
                    debug(`\tcalculating SearchContents for ${tracing.id}`);

                    await Tracing.calculateSearchContents(tracing.id);
                }
            }

            await reconstruction.update({status: ReconstructionStatus.PendingPrecomputed});

            updates.push(reconstruction.id);
        }

        reloadReconstructionCache(updates);

        sanitySearchContentsCheckCount = 0;
    } else {
        sanitySearchContentsCheckCount++;

        if (sanitySearchContentsCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingSearchContents state`);
            sanitySearchContentsCheckCount = 0;
        }
    }
}

/**
 * Create an empty Precomputed entry for where needed for the python precomputed skeleton service to pick up.
 */
async function notifyPrecomputed() {
    const ready = await Reconstruction.findPrecomputedMissing();

    if (ready.length > 0) {
        debug(`${ready.length} precomputed entries to be queued`);
        const precomputed = ready.map(r => {
            return {
                "reconstructionId": r.id
            }
        });

        await Precomputed.bulkCreate(precomputed);

        sanityNotifyPrecomputedCheckCount = 0;
    } else {
        sanityNotifyPrecomputedCheckCount++;

        if (sanityNotifyPrecomputedCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingPrecomputed state`);
            sanityNotifyPrecomputedCheckCount = 0;
        }
    }
}

async function checkPrecomputedComplete() {
    const pending = await Reconstruction.getPublishPending(ReconstructionStatus.PendingPrecomputed);

    if (pending.length > 0) {
        debug(`${pending.length} reconstructions have precomputed skeletons pending`);

        const updates: string[] = [];

        for (let reconstruction of pending) {
            if (reconstruction.Precomputed.version > 0 && reconstruction.Precomputed.generatedAt) {
                await reconstruction.update({status: ReconstructionStatus.Published, completedAt: Date.now()});

                updates.push(reconstruction.id);
            }
        }

        reloadReconstructionCache(updates);

        sanityCompletedPrecomputedCheckCount = 0;
    } else {
        sanityCompletedPrecomputedCheckCount++;

        if (sanityCompletedPrecomputedCheckCount >= sanityCheckInterval) {
            debug(`there are no reconstructions in the PendingPrecomputed state with completed skeletons`);
            sanityCompletedPrecomputedCheckCount = 0;
        }
    }
}

async function qualityCheckPendingWorker() {
    const pending = await Reconstruction.getQualityCheckPending();

    if (pending.length > 0) {
        debug(`${pending.length} reconstructions have quality control check pending`);

        for (let id of pending) {
            await Reconstruction.requestQualityCheck(id);
        }

        sanityQualityCheckPendingCount = 0;
    } else {
        sanityQualityCheckPendingCount++;

        if (sanityQualityCheckPendingCount >= sanityCheckInterval) {
            debug(`there are no reconstructions with quality control check pending`);
            sanityQualityCheckPendingCount = 0;
        }
    }
}
