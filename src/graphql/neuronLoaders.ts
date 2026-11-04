import DataLoader = require("dataloader");
import {Op} from "sequelize";

import {BaseModel} from "../models/baseModel";
import {Neuron} from "../models/neuron";
import {Specimen} from "../models/specimen";
import {AtlasStructure} from "../models/atlasStructure";
import {Annotation} from "../models/annotation";

export type NeuronLoaders = {
    specimen: DataLoader<string, Specimen>;
    atlasStructure: DataLoader<string, AtlasStructure>;
    annotationCount: DataLoader<string, number>;
    annotations: DataLoader<string, Annotation[]>;
    published: DataLoader<string, Annotation>;
    untraceable: DataLoader<string, boolean>;
};

function alignById<T extends BaseModel>(ids: readonly string[], rows: T[]): T[] {
    const byId = new Map(rows.map(row => [row.id, row]));

    return ids.map(id => byId.get(id) ?? null);
}

// Memoization ends when a batch dispatches.  Keys repeated within a tick still collapse into one batch entry, but a
// mutation operation runs its top-level fields serially, and a later field must read rows an earlier one changed.
function batchScopedLoader<V>(batch: (ids: readonly string[]) => Promise<V[]>): DataLoader<string, V> {
    const loader: DataLoader<string, V> = new DataLoader(async (ids: readonly string[]) => {
        loader.clearAll();

        return batch(ids);
    }, {maxBatchSize: BaseModel.PreferredDatabaseChunkSize});

    return loader;
}

export function createNeuronLoaders(): NeuronLoaders {
    return {
        specimen: batchScopedLoader(async ids => alignById(ids, await Specimen.findAll({where: {id: {[Op.in]: [...ids]}}}))),
        atlasStructure: batchScopedLoader(async ids => alignById(ids, await AtlasStructure.findAll({where: {id: {[Op.in]: [...ids]}}}))),
        annotationCount: batchScopedLoader(ids => Neuron.annotationCounts(ids)),
        annotations: batchScopedLoader(ids => Neuron.annotationsByNeuron(ids)),
        published: batchScopedLoader(ids => Neuron.publishedByNeuron(ids)),
        untraceable: batchScopedLoader(ids => Neuron.untraceableByNeuron(ids))
    };
}
