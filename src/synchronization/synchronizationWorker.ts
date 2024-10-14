import {Op} from "sequelize";

import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Neuron} from "../models/neuron";
import {Tracing} from "../models/tracing";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {SynchronizationMarker, SynchronizationMarkerKind} from "../models/synchronizationMarker";
import {Precomputed} from "../models/precomputed";

setTimeout(async () => {
    await RemoteDatabaseClient.Start();

    await performSynchronization();

}, 1000);

/**
 * Perform one pass of synchronizing published reconstruction data.
 *
 * @param repeat - `true` to call itself repeatedly as the specified interval (default `true`)
 * @param intervalSeconds - delay in seconds between successive calls when `repeat` is `true` (default `60`)
 */
async function performSynchronization(repeat: boolean = true, intervalSeconds = 60) {

    await republishUpdatedNeurons();

    await publishUntransformedTracings();

    await notifyPrecomputed();

    if (repeat) {
        setTimeout(async () => {
            await performSynchronization(repeat, intervalSeconds);
        }, intervalSeconds * 1000);
    }
}

/**
 * Find neurons with published reconstructions that have been updated since the last time we checked.  These need their derived SearchContents
 * updated if one of the property changes is relevant.
 *
 * @remarks Currently implemented for any property change, even ones that do not have downstream SearchContents implications.
 */
async function republishUpdatedNeurons() {
    const when = Date.now();

    let lastMarker = await SynchronizationMarker.lastMarker(SynchronizationMarkerKind.Neuron);

    let neurons: Neuron[] = [];

    const options = {
        where: {
            "$Reconstructions.status$": ReconstructionStatus.Complete
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

    neurons = await Neuron.findAll(options);

    if (neurons.length > 0) {
        console.log(`${neurons.length} neuron(s) with a published reconstruction updated since last synchronization`);

        await neurons.reduce(async (p: Promise<void>, n) => {
            await p;

            const tracings = await Tracing.getForNeuron(n.id);

            console.log(`\t${tracings.length} tracings for neuron ${n.id}`);

            const tracingPromises = tracings.map(async (t) => {
                const result = await Tracing.applyTransform(t.id);

                if (result.tracing) {
                    process.send(t.id);
                }
            });

            await Promise.all(tracingPromises);
        }, Promise.resolve());
    }

    await lastMarker.update({appliedAt: when});
}

// With default settings, this will give a heartbeat message that everything is published once per hour.
const sanityCheckInterval = 60;
let sanityCheckCount = 0;

/**
 * Find recently uploaded tracings for published reconstructions that require node brain structure lookup and search content entries.
 */
async function publishUntransformedTracings() {
    const tracings = await Tracing.getUntransformed(true);

    if (tracings.length > 0) {
        console.log(`${tracings.length} published tracings have not been transformed`);

        await tracings.reduce(async (p: Promise<void>, t) => {
            await p;

            console.log(`\t applying transform to ${t.id}`);

            const result = await Tracing.applyTransform(t.id);

            if (result.tracing) {
                process.send(t.id);
            }
        }, Promise.resolve());

        sanityCheckCount = 0;
    } else {
        sanityCheckCount++;

        if (sanityCheckCount >= sanityCheckInterval) {
            console.log(`All published tracings have been transformed`);
            sanityCheckCount = 0;
        }
    }
}

/**
 * Create an empty Precomputed entry for where needed for the python precomputed skeleton service to pick up.
 */
async function notifyPrecomputed() {
    const options = {
        where: {
            "status": ReconstructionStatus.Complete,
            "$Precomputed$": null
        },
        include: [
            {
                model: Precomputed,
                as: "Precomputed"
            }
        ]
    };

    const ready = await Reconstruction.findAll(options);

    if (ready.length > 0) {
        const precomputed = ready.map(r => {
            return {
                "reconstructionId": r.id
            }
        });

        await Precomputed.bulkCreate(precomputed);
    }
}
