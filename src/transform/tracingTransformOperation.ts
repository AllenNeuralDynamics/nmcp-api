import uuid = require("uuid");

import {BrainArea} from "../models/brainArea";
import {Tracing} from "../models/tracing";
import {ServiceOptions} from "../options/serviceOptions";
import {NrrdFile} from "../io/nrrd";
import {CompartmentStatistics, ICompartmentStatistics} from "./compartmentStatistics";
import {TracingNode} from "../models/tracingNode";
import {StructureIdentifier, StructureIdentifiers} from "../models/structureIdentifier";
import {SearchContent} from "../models/searchContent";

const preferredDatabaseChunkSize = 25000;

export interface ITransformOperationProgressStatus {
    inputNodeCount?: number;
    outputNodeCount?: number;
}

export interface ITransformOperationProgress {
    tracingId: string | null;
    status: ITransformOperationProgressStatus;
}

export interface ITransformOperationLogger {
    (message: any): void;
}

export interface ITransformOperationProgressDelegate {
    (progress: ITransformOperationProgress): void;
}

export interface ITransformOperationContext {
    compartmentMap: Map<number, BrainArea>;
    tracing: Tracing;
    logger?: ITransformOperationLogger;
    progressDelegate?: ITransformOperationProgressDelegate;
}

export type CompartmentStatisticsMap = Map<string, ICompartmentStatistics>;

export class TransformOperation {
    private _context: ITransformOperationContext;

    private _ccfv30CompartmentMap: CompartmentStatisticsMap;

    private _nrrdContent: NrrdFile;

    public get Tracing(): Tracing {
        return this._context.tracing;
    }

    public constructor(context: ITransformOperationContext) {
        this._context = context;
    }

    public async processTracing(): Promise<void> {
        await this.assignNodeCompartments();

        await this.updateTracing();
    }

    private async assignNodeCompartments(): Promise<void> {
        this._ccfv30CompartmentMap = new Map<string, ICompartmentStatistics>();

        this._nrrdContent = new NrrdFile(ServiceOptions.ccfv30OntologyPath);

        this._nrrdContent.init();

        this.logMessage(`brain lookup extents (nrrd30 order) ${this._nrrdContent.size[0]} ${this._nrrdContent.size[1]} ${this._nrrdContent.size[2]}`);

        const count = await TracingNode.count({where: {tracingId: this.Tracing.id}});

        this.logMessage(`assigning compartments to ${count} nodes for tracing ${this.Tracing.id}`);

        let failedLookupTotal = 0;

        for (let idx = 0; idx < count; idx += preferredDatabaseChunkSize) {
            const nodes = await TracingNode.findAll({where: {tracingId: this.Tracing.id}, offset: idx, limit: preferredDatabaseChunkSize, order: [["sampleNumber", "ASC"]]});

            this.logMessage(`\tassigning compartments for chunk starting at ${idx} for tracing ${this.Tracing.id}`);

            failedLookupTotal += await this.assignNodeChunkCompartments(nodes);

            this.logMessage("\tpartial assignment complete");
        }

        this.logMessage(`\tassignment complete (${failedLookupTotal} failed lookups)`);

        this._nrrdContent.close();
    }

    private async assignNodeChunkCompartments(nodes: TracingNode[]): Promise<number> {
        if (!nodes) {
            return 0;
        }

        const nrrdContent = this._nrrdContent;

        let failedLookup = 0;

        const somaStructureId = StructureIdentifier.idForValue(StructureIdentifiers.soma);

        const promises = nodes.map(async (node, index) => {
            let brainStructureId: string = node.brainStructureId;

            if (!brainStructureId) {
                try {
                    const transformedLocation = [Math.ceil(node.x / 10), Math.ceil(node.y / 10), Math.ceil(node.z / 10)].reverse();

                    const allenStructureId: number = nrrdContent.findStructureId(transformedLocation[0], transformedLocation[1], transformedLocation[2]);

                    brainStructureId = this.findCompartmentId(allenStructureId);
                } catch (err) {
                    this.logMessage(`${index}`);
                    this.logMessage(err);
                }

                if (!brainStructureId) {
                    failedLookup++;
                    brainStructureId = this._context.compartmentMap.get(997).id;
                }

                await node.update({brainStructureId: brainStructureId});
            }

            this.populateCompartmentMap(brainStructureId, node);

            if (node.structureIdentifierId == somaStructureId && this._context.tracing?.Reconstruction?.Neuron?.brainStructureId) {
                const somaBrainStructureId = this._context.tracing?.Reconstruction.Neuron.brainStructureId;

                if (somaBrainStructureId != brainStructureId) {
                    this.populateCompartmentMap(somaBrainStructureId, node, true);
                }
            }
        });

        await Promise.all(promises);

        if (failedLookup > 0) {
            this.logMessage(`\t\t${failedLookup} of ${nodes.length} nodes failed the brain structure lookup`);
        }

        return failedLookup;
    }

    private async updateTracing(): Promise<void> {
        if (this.Tracing.id === null) {
            this.logMessage("\tcan not update tracing without context id");
            return;
        }

        this.logMessage("\tstarting tracing dependent updates");

        await this.updateBrainCompartmentContent();

        const now = Date.now();

        await this.Tracing.update({nodeLookupAt: now, searchTransformAt: now});
    }

    private findCompartmentId(structureId: number): string {
        if (this._context.compartmentMap.has(structureId)) {
            return this._context.compartmentMap.get(structureId).id;
        }

        return null;
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

        this.logMessage("\tremoving exising SearchContent entries");

        await SearchContent.destroy({where: {tracingId: tracing.id}, force: true});

        let searchContentByBrainStructure = [];

        this.logMessage(`\tpreparing ${this._ccfv30CompartmentMap.size} SearchContent entries`);

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

        this.logMessage(`\tinserting ${this._ccfv30CompartmentMap.size} SearchContent entries`);

        await Tracing.sequelize.transaction(async (t) => {
            const chunkSize = 100000;

            for (let idx = 0; idx < searchContentByBrainStructure.length; idx += chunkSize) {
                await SearchContent.bulkCreate(searchContentByBrainStructure.slice(idx, idx + chunkSize), {transaction: t});
            }
        });

        this.logMessage(`inserted ${searchContentByBrainStructure.length} brain compartment stats`);
    }

    private logMessage(message: any): void {
        if (this._context.logger) {
            this._context.logger(message);
        }
    }
}
