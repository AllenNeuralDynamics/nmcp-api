import uuid = require("uuid");

import {Tracing} from "../models/tracing";
import {CompartmentStatistics} from "./compartmentStatistics";
import {TracingNode} from "../models/tracingNode";
import {StructureIdentifier, StructureIdentifiers} from "../models/structureIdentifier";
import {SearchContent} from "../models/searchContent";

const debug = require("debug")("nmcp:transform:transform-operation");

const preferredDatabaseChunkSize = 25000;

export type CompartmentStatisticsMap = Map<string, CompartmentStatistics>;

export class SearchContentOperation {
    private readonly _tracing: Tracing;

    private _ccfv30CompartmentMap: CompartmentStatisticsMap;

    public get Tracing(): Tracing {
        return this._tracing;
    }

    public constructor(tracing: Tracing) {
        this._tracing = tracing;
    }

    public async processTracing(): Promise<void> {
        await this.assignNodeCompartments();

        await this.assignSearchCompartments();
    }

    private async assignNodeCompartments(): Promise<void> {
        this._ccfv30CompartmentMap = new Map<string, CompartmentStatistics>();

        const count = await TracingNode.count({where: {tracingId: this.Tracing.id}});

        debug(`assigning SearchContents for ${count} nodes for tracing ${this.Tracing.id}`);

        for (let idx = 0; idx < count; idx += preferredDatabaseChunkSize) {
            const nodes = await TracingNode.findAll({
                where: {tracingId: this.Tracing.id},
                offset: idx,
                limit: preferredDatabaseChunkSize,
                order: [["sampleNumber", "ASC"]]
            });

            debug(`\tassigning SearchContents for chunk starting at ${idx} for tracing ${this.Tracing.id}`);

            await this.assignNodeChunkCompartments(nodes);
        }

        debug(`\tassignment complete`);
    }

    private async assignNodeChunkCompartments(nodes: TracingNode[]) {
        if (!nodes) {
            return 0;
        }

        const somaStructureId = StructureIdentifier.idForValue(StructureIdentifiers.soma);

        const neuronSomaBrainStructureId = this._tracing?.Reconstruction?.Neuron?.brainStructureId;

        for (let node of nodes) {
            let brainStructureId: string = node.brainStructureId;

            this.populateCompartmentMap(brainStructureId, node);

            if (node.structureIdentifierId == somaStructureId && neuronSomaBrainStructureId) {
                // If the Neuron has a manually assigned soma brain structure, and it does not match the automatic Atlas matches structure,
                // include soma in the SearchContent entry for this structure.  That allows searches by soma to return the neuron for both
                // the manual and automatic structures.
                if (neuronSomaBrainStructureId != brainStructureId) {
                    this.populateCompartmentMap(neuronSomaBrainStructureId, node);
                }
            }
        }
    }

    private async assignSearchCompartments(): Promise<void> {
        if (this.Tracing.id === null) {
            debug("\tcan not update tracing without context id");
            return;
        }

        debug("\tstarting tracing dependent updates");

        await this.updateBrainCompartmentContent();
    }

    private populateCompartmentMap(brainAreaId: string, node: TracingNode, increaseTotalNodeCount: boolean = true) {
        if (brainAreaId) {
            if (!this._ccfv30CompartmentMap.has(brainAreaId)) {
                this._ccfv30CompartmentMap.set(brainAreaId, new CompartmentStatistics())
            }

            let counts = this._ccfv30CompartmentMap.get(brainAreaId);

            counts.addNode(StructureIdentifier.valueForId(node.structureIdentifierId), increaseTotalNodeCount);
        }
    }

    private async updateBrainCompartmentContent() {
        const tracing = this.Tracing;

        const reconstruction = await tracing.getReconstruction();

        const neuron = await reconstruction.getNeuron();

        debug("\tremoving exising SearchContent entries");

        await SearchContent.destroy({where: {tracingId: tracing.id}, force: true});

        let searchContentByBrainStructure = [];

        debug(`\tpreparing ${this._ccfv30CompartmentMap.size} SearchContent entries`);

        for (const entry of this._ccfv30CompartmentMap.entries()) {
            searchContentByBrainStructure.push({
                id: uuid.v4(),
                tracingId: tracing.id,
                tracingStructureId: tracing.tracingStructureId,
                neuronId: neuron.id,
                somaX: neuron.x,
                somaY: neuron.y,
                somaZ: neuron.z,
                neuronIdString: neuron.idString,
                neuronDOI: neuron.doi,
                neuronConsensus: neuron.consensus,
                brainAreaId: entry[0],
                nodeCount: entry[1].Node,
                somaCount: entry[1].Soma,
                pathCount: entry[1].Path,
                branchCount: entry[1].Branch,
                endCount: entry[1].End
            });
        }

        debug(`\tinserting ${this._ccfv30CompartmentMap.size} SearchContent entries`);

        await Tracing.sequelize.transaction(async (t) => {
            const chunkSize = 100000;

            for (let idx = 0; idx < searchContentByBrainStructure.length; idx += chunkSize) {
                await SearchContent.bulkCreate(searchContentByBrainStructure.slice(idx, idx + chunkSize), {transaction: t});
            }
        });

        debug(`\tinserted ${searchContentByBrainStructure.length} SearchContent entries`);
    }
}
