import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Neuron} from "../models/neuron";
import {SynchronizationMarker, SynchronizationMarkerKind} from "../models/synchronizationMarker";
import {Op} from "sequelize";

setTimeout(async () => {
    await RemoteDatabaseClient.Start(false);

    await performSynchronization();

}, 10000);

async function performSynchronization() {
    console.log("perform synchronization");

    await verifyNeuronSearchContents();

    console.log("queue next perform synchronization");

    setTimeout(async () => {
        await performSynchronization();

    }, 5 * 60 * 1000);
}

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

    console.log(`${neurons.length} neurons updated since last synchronization`);

    if (neurons.length > 0) {
        const updatePromises = neurons.map(n => {

        });

        await Promise.all(updatePromises);
    }

    await lastMarker.update({appliedAt: when});
}
