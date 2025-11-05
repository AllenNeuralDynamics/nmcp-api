import {SearchIndexCounts} from "./searchIndexCounts";
import {NodeStructure} from "../models/nodeStructure";
import {SearchIndex, SearchIndexShape} from "../models/searchIndex";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {AtlasNode} from "../models/atlasNode";
import {Neuron} from "../models/neuron";
import {NeuronStructure} from "../models/neuronStructure";
import {Transaction} from "sequelize";
import {Specimen} from "../models/specimen";
import {Atlas} from "../models/atlas";

const debug = require("debug")("nmcp:transform:transform-operation");

const preferredDatabaseChunkSize = 25000;

export type StatisticsMap = Map<string, SearchIndexCounts>;

export class SearchIndexOperation {
    private readonly _reconstruction: AtlasReconstruction;

    private _neuron: Neuron;

    private _neuronSomaStructureId: string;

    private _soma: AtlasNode;

    public constructor(reconstruction: AtlasReconstruction) {
        this._reconstruction = reconstruction;
    }

    public async process(t: Transaction): Promise<void> {
        const reconstruction = await this._reconstruction.getReconstruction();

        this._neuron = await reconstruction.getNeuron({
            include: [{
                model: Specimen,
                as: "Specimen"
            }]
        });

        this._neuronSomaStructureId = this._neuron.atlasStructureId;

        this._soma = await this._reconstruction.getSoma();

        const axonNodeCounts = await this.countNodesPerStructure(NeuronStructure.AxonStructureId);
        const dendriteNodeCounts = await this.countNodesPerStructure(NeuronStructure.DendriteStructureId);
        const somaCounts = this.createSomaEntries();


        await this.assignSearchCompartments(axonNodeCounts, NeuronStructure.AxonStructureId, t);
        await this.assignSearchCompartments(dendriteNodeCounts, NeuronStructure.DendriteStructureId, t);
        await this.assignSearchCompartments(somaCounts, NeuronStructure.SomaNeuronStructureId, t);
    }

    private createSomaEntries(): StatisticsMap {
        const nodeCountMap = new Map<string, SearchIndexCounts>();

        this._populateCompartmentMap(nodeCountMap, this._soma);

        if (this._neuronSomaStructureId != this._soma.atlasStructureId) {
            // If the Neuron has a manually assigned soma atlas structure, and it does not match the automatic atlas structure,
            // include soma in the entries for this atlas structure.  That allows searches by soma to return the neuron for both
            // the manual and automatic structures.
            this._populateCompartmentMap(nodeCountMap, this._soma, this._neuronSomaStructureId);
        }

        return nodeCountMap;
    }

    private async countNodesPerStructure(neuronStructureId: string): Promise<StatisticsMap> {
        const nodeCountMap = new Map<string, SearchIndexCounts>();

        const where = {reconstructionId: this._reconstruction.id, neuronStructureId: neuronStructureId};

        const count = await AtlasNode.count({where: where});

        debug(`assigning node counts for ${count} ${neuronStructureId} nodes for reconstruction ${this._reconstruction.id}`);

        for (let idx = 0; idx < count; idx += preferredDatabaseChunkSize) {
            const nodes = await AtlasNode.findAll({
                where: where,
                offset: idx,
                limit: preferredDatabaseChunkSize,
                order: [["index", "ASC"]]
            });

            debug(`\tassigning SearchContents for chunk starting at ${idx} for reconstruction ${this._reconstruction.id}`);

            for (const node of nodes) {
                this._populateCompartmentMap(nodeCountMap, node);
            }
        }

        // Contribute to the total node count for this neuron structure type in this atlas structure.
        this._populateCompartmentMap(nodeCountMap, this._soma);

        debug(`\tassignment complete`);

        return nodeCountMap;
    }

    private _populateCompartmentMap(nodeCountMap: StatisticsMap, node: AtlasNode, overrideAtlasStructureId: string = null) {
        const atlasStructureId = overrideAtlasStructureId ?? node.atlasStructureId;

        if (atlasStructureId) {
            if (!nodeCountMap.has(atlasStructureId)) {
                nodeCountMap.set(atlasStructureId, new SearchIndexCounts())
            }

            let counts = nodeCountMap.get(atlasStructureId);

            counts.addNode(NodeStructure.valueForId(node.nodeStructureId));
        } {
            // TODO SystemError that structure assigment didn't default to root structure.
        }
    }

    private async assignSearchCompartments(nodeCountMap: StatisticsMap, neuronStructureId: string, t: Transaction) {
        if (this._reconstruction.id === null) {
            debug("\tcan not update reconstruction without id");
            return;
        }

        debug("\tremoving exising SearchContent entries");

        await SearchIndex.destroy({where: {reconstructionId: this._reconstruction.id}});

        let searchContentByBrainStructure: SearchIndexShape[] = [];

        debug(`\tpreparing ${nodeCountMap.size} SearchIndex entries`);

        // TODO Have ensured neuron atlas soma is always valid?
        for (const [key, value] of nodeCountMap.entries()) {
            searchContentByBrainStructure.push({
                somaX: this._neuron.atlasSoma.x,
                somaY: this._neuron.atlasSoma.y,
                somaZ: this._neuron.atlasSoma.z,
                nodeCount: value.node,
                pathCount: value.path,
                branchCount: value.branch,
                endCount: value.end,
                neuronLabel: this._neuron.label,
                doi: this._reconstruction.doi,
                atlasKindId: this._neuron.Specimen.getAtlas().atlasKindId,
                atlasId: this._neuron.Specimen.atlasId,
                collectionId: this._neuron.Specimen.collectionId,
                neuronId: this._neuron.id,
                reconstructionId: this._reconstruction.id,
                neuronStructureId: neuronStructureId,
                atlasStructureId: key,
            });
        }

        debug(`\tinserting ${nodeCountMap.size} SearchIndex entries for neuron structure ${neuronStructureId}`);

        const chunkSize = SearchIndex.PreferredDatabaseChunkSize;

        for (let idx = 0; idx < searchContentByBrainStructure.length; idx += chunkSize) {
            await SearchIndex.bulkCreate(searchContentByBrainStructure.slice(idx, idx + chunkSize), {transaction: t});
        }

        debug(`\tinserted ${searchContentByBrainStructure.length} SearchIndex entries`);
    }
}
