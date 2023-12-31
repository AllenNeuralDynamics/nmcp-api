import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Neuron} from "../models/neuron";
import {SynchronizationMarker, SynchronizationMarkerKind} from "../models/synchronizationMarker";
import {Op} from "sequelize";
import {Tracing} from "../models/tracing";

setTimeout(async () => {
    await RemoteDatabaseClient.Start(false);

    await performSynchronization();

}, 10000);

async function performSynchronization() {
    console.log("perform synchronization");

    await verifyNeuronSearchContents();

    await verifyUntransformedTracings();

    console.log("queue next perform synchronization");

    setTimeout(async () => {
        await performSynchronization();

    }, 0.5 * 60 * 1000);
}

/**
 * Find neurons that have been updated since the last time we checked.  These need their derived SearchContents
 * updated if one of the property changes is relevant.
 *
 * Currently implemented for any property change, even ones that do not have downstream SearchContents implications.
 *
 * TODO Changing Sample visibility where the Neuron has inherited will not trigger this.  Changing sample visibility
 * needs to change the updatedAt value for any Neuron w/inherited visibility
 */
async function verifyNeuronSearchContents() {
    const when = Date.now();

    let lastMarker = await SynchronizationMarker.lastMarker(SynchronizationMarkerKind.Neuron);

    let neurons: Neuron[] = [];

    if (lastMarker == null) {
        lastMarker = await SynchronizationMarker.create({markerKind: SynchronizationMarkerKind.Neuron});

        neurons = await Neuron.findAll();
    } else {
        neurons = await Neuron.findAll({
            where: {updatedAt: {[Op.gt]: lastMarker.updatedAt}}
        });
    }

    if (neurons.length > 0) {
        console.log(`${neurons.length} neurons updated since last synchronization`);

        const updatePromises = neurons.map(async(n) => {
            const tracings = await Tracing.getForNeuron(n.id);

            console.log(`${tracings.length} tracings for neuron ${n.id}`);

            const tracingPromises = tracings.map(async(t) => {
                await Tracing.applyTransform(t.id);
            });

            return Promise.all(tracingPromises);
        });

        await Promise.all(updatePromises);
    }

    await lastMarker.update({appliedAt: when});
}

/**
 * Find recently uploaded tracings that require node brain structure lookup and search contents
 * to be generated.
 */
async function verifyUntransformedTracings() {
    const tracings = await Tracing.getUntransformed();

    if(tracings.length > 0) {
        console.log(`${tracings.length} tracings have not been transformed`);

        const updatePromises = tracings.map(async (t) => {
            await Tracing.applyTransform(t.id);
        })

        await Promise.all(updatePromises);
    }
}
