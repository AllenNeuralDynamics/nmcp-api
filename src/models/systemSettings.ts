import {ServiceOptions} from "../options/serviceOptions";
import {Neuron} from "./neuron";

export type SystemSettings = {
    apiVersion: string;
    neuronCount: number;
    features: {
        enableUpdatedViewer: boolean;
    }
}

let publishCount: number = -1;

export function resetPublishedCount() {
    publishCount = -1;
}

export async function publishedCount(): Promise<number> {
    if (publishCount < 0) {
        publishCount = await Neuron.publishedCount();
    }

    return publishCount;
}

export async function getSystemSettings(): Promise<SystemSettings> {
    if (publishCount < 0) {
        publishCount = await Neuron.publishedCount();
    }

    return {
        apiVersion: ServiceOptions.version,
        neuronCount: await publishedCount(),
        features: {
            enableUpdatedViewer: ServiceOptions.allowExperimentalFeatures
        }
    }
}
