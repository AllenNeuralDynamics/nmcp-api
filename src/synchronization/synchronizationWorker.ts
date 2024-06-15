import {Op} from "sequelize";

import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Neuron} from "../models/neuron";
import {Tracing} from "../models/tracing";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {SharingVisibility} from "../models/sharingVisibility";
import {Sample} from "../models/sample";
import {SynchronizationMarker, SynchronizationMarkerKind} from "../models/synchronizationMarker";

setTimeout(async () => {
    await RemoteDatabaseClient.Start(false);

    await performSynchronization();

}, 10000);

async function performSynchronization() {

    await verifyNeuronSearchContents();

    await verifyUntransformedTracings();

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
 * needs to change the updatedAt value for any Neuron w/inherited visibility.
 *
 * TODO Does not remove something from the transformed data set if the visibility is reduced (e.g., public to internal or not shared)
 */
async function verifyNeuronSearchContents() {
    const when = Date.now();

    let lastMarker = await SynchronizationMarker.lastMarker(SynchronizationMarkerKind.Neuron);

    let neurons: Neuron[] = [];

    const options = {
        where: {
            visibility: {[Op.or]: [SharingVisibility.ShareAllExternal, SharingVisibility.Inherited]}
        },
        include: {
            model: Sample,
            as: "Sample",
            attributes: ["id", "visibility"]
        }
    };

    if (lastMarker == null) {
        lastMarker = await SynchronizationMarker.create({markerKind: SynchronizationMarkerKind.Neuron});
    } else {
        options.where["updatedAt"] =  {[Op.gt]: lastMarker.updatedAt};
    }

    neurons = await Neuron.findAll(options);

    neurons = neurons.filter(isPublicNeuron);

    if (neurons.length > 0) {
        console.log(`${neurons.length} neurons updated since last synchronization`);

        const updatePromises = neurons.map(async (n) => {
            const tracings = await Tracing.getForNeuron(n.id);

            console.log(`${tracings.length} tracings for neuron ${n.id}`);

            const tracingPromises = tracings.map(async (t) => {
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
    const untransformedTracings = await Tracing.getUntransformed();

    const readyPromises = untransformedTracings.map(async (t) => {
        const reconstruction = await Reconstruction.findByPk(t.reconstructionId,
            {
                include: [{
                    model: Neuron,
                    as: "Neuron",
                    attributes: ["id", "visibility"],
                    include: [{
                        model: Sample,
                        as: "Sample",
                        attributes: ["id", "visibility"]
                    }]
                }]
            });

        if (reconstruction && isPublicNeuron(reconstruction.Neuron)) {
            return reconstruction.status == ReconstructionStatus.Complete;
        }

        return false;
    });

    const ready = await Promise.all(readyPromises);

    const tracings = untransformedTracings.filter((t, index) => ready[index]);

    if (tracings.length > 0) {
        console.log(`${tracings.length} tracings have not been transformed`);

        const updatePromises = tracings.map(async (t) => {
            await Tracing.applyTransform(t.id);
        })

        await Promise.all(updatePromises);
    }
}

function isPublicNeuron(neuron: Neuron): boolean {
    return neuron.visibility == SharingVisibility.ShareAllExternal
        || (neuron.visibility == SharingVisibility.Inherited && neuron.Sample.visibility == SharingVisibility.ShareAllExternal);
}
