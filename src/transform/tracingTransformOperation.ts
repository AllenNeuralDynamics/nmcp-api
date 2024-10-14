import uuid = require("uuid");

import {BrainArea} from "../models/brainArea";
import {Tracing} from "../models/tracing";
import {ServiceOptions} from "../options/serviceOptions";
import {NrrdFile} from "../io/nrrd";
import {CompartmentStatistics, ICompartmentStatistics} from "./compartmentStatistics";
import {TracingNode} from "../models/tracingNode";
import {StructureIdentifier, StructureIdentifiers} from "../models/structureIdentifier";
import {SearchContent} from "../models/searchContent";

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

    public async assignNodeCompartments(): Promise<void> {
        const nodes = this._context.tracing.Nodes;

        if (!nodes) {
            return;
        }

        const nrrdContent = new NrrdFile(ServiceOptions.ccfv30OntologyPath);

        nrrdContent.init();

        this.logMessage(`brain lookup extents (nrrd30 order) ${nrrdContent.size[0]} ${nrrdContent.size[1]} ${nrrdContent.size[2]}`);

        this._ccfv30CompartmentMap = new Map<string, ICompartmentStatistics>();

        let failedLookup = 0;

        const somaStructureId = StructureIdentifier.idForValue(StructureIdentifiers.soma);

        const promises = nodes.map(async (node, index) => {
            let brainAreaIdCcfv30: string = null;

            try {
                // In NRRD z, y, x order after reverse
                const transformedLocation = [Math.ceil(node.x / 10), Math.ceil(node.y / 10), Math.ceil(node.z / 10)].reverse();

                // const brainAreaInput = [0, 0, 0];
                const ccfv30StructureId: number = nrrdContent.findStructureId(transformedLocation[0], transformedLocation[1], transformedLocation[2]);

                brainAreaIdCcfv30 = this.findCompartmentId(ccfv30StructureId);
            } catch (err) {
                this.logMessage(`${index}`);
                this.logMessage(err);
            }

            if (!brainAreaIdCcfv30) {
                failedLookup++;
                // this.logMessage(`failed brain structure lookup for ${swcNode.sampleNumber}`);
                brainAreaIdCcfv30 = this._context.compartmentMap.get(997).id;
            }

            this.populateCompartmentMap(brainAreaIdCcfv30, node);

            await node.update({brainStructureId: brainAreaIdCcfv30});

            if (node.structureIdentifierId == somaStructureId && this._context.tracing?.Reconstruction?.Neuron?.brainStructureId) {
                const somaBrainStructureId = this._context.tracing?.Reconstruction.Neuron.brainStructureId;

                if (somaBrainStructureId != brainAreaIdCcfv30) {
                    this.populateCompartmentMap(somaBrainStructureId, node, true);
                }
            }
        });

        await Promise.all(promises);

        if (failedLookup > 0) {
            this.logMessage(`${failedLookup} of ${nodes.length} nodes failed the brain structure lookup`);
        }

        this.logMessage("assignment complete");

        nrrdContent.close();
    }

    public async updateTracing(): Promise<void> {
        if (this.Tracing.id === null) {
            this.logMessage(`can not update tracing without context id`);
            return;
        }

        this.logMessage("starting tracing dependent updates");

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

        await SearchContent.destroy({where: {tracingId: tracing.id}, force: true});

        let searchContentByBrainStructure = [];

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

        await SearchContent.bulkCreate(searchContentByBrainStructure)

        this.logMessage(`inserted ${searchContentByBrainStructure.length} brain compartment stats`);
    }

    private logMessage(message: any): void {
        if (this._context.logger) {
            this._context.logger(message);
        }
    }
}
