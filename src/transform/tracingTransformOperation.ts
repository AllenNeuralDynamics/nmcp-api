import uuid = require("uuid");

import {BrainArea} from "../models/brainArea";
import {Tracing} from "../models/tracing";
import {ServiceOptions} from "../options/serviceOptions";
import {NrrdFile} from "../io/nrrd";
import {CompartmentStatistics, ICompartmentStatistics} from "./compartmentStatistics";
import {TracingNode} from "../models/tracingNode";
import {StructureIdentifier} from "../models/structureIdentifier";
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
    swcTracing: Tracing;
    logger?: ITransformOperationLogger;
    progressDelegate?: ITransformOperationProgressDelegate;
}

export type CompartmentStatisticsMap = Map<string, ICompartmentStatistics>;

export class TransformOperation {
    private _context: ITransformOperationContext;

    private _ccfv30CompartmentMap: CompartmentStatisticsMap;

    public get Tracing(): Tracing {
        return this._context.swcTracing;
    }

    public constructor(context: ITransformOperationContext) {
        this._context = context;
    }

    public async processTracing(): Promise<void> {
        await this.assignNodeCompartments();

        await this.updateTracing();
    }

    public async assignNodeCompartments(): Promise<void> {
        const nodes = await this._context.swcTracing.getNodes();

        if (!nodes) {
            return;
        }

        const nrrdContent = new NrrdFile(ServiceOptions.ccfv30OntologyPath);

        nrrdContent.init();

        this.logMessage(`brain lookup extents (nrrd30 order) ${nrrdContent.size[0]} ${nrrdContent.size[1]} ${nrrdContent.size[2]}`);

        this._ccfv30CompartmentMap = new Map<string, ICompartmentStatistics>();

        let failedLookup = 0;

        nodes.map(async (swcNode, index) => {
            let brainAreaIdCcfv30: string = null;

            try {
                // In NRRD z, y, x order after reverse
                const transformedLocation = [Math.ceil(swcNode.x / 10), Math.ceil(swcNode.y / 10), Math.ceil(swcNode.z / 10)].reverse();

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
            this.populateCompartmentMap(brainAreaIdCcfv30, swcNode);

            await swcNode.update({brainStructureId: brainAreaIdCcfv30});
        });

        if (failedLookup > 0) {
            this.logMessage(`${failedLookup} node(s) failed the brain structure lookup`);
        }

        this.logMessage("assignment complete");

        nrrdContent.close();
    }

    public async updateTracing(): Promise<void> {
        if (this.Tracing.id === null) {
            this.logMessage(`can not update tracing without context id`);
            return;
        }

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

    private populateCompartmentMap(brainAreaId: string, node: TracingNode) {
        if (brainAreaId) {
            if (!this._ccfv30CompartmentMap.has(brainAreaId)) {
                this._ccfv30CompartmentMap.set(brainAreaId, new CompartmentStatistics())
            }

            let counts = this._ccfv30CompartmentMap.get(brainAreaId);

            counts.addNode(StructureIdentifier.valueForId(node.structureIdentifierId));
        }
    }

    private async updateBrainCompartmentContent() {
        const tracing = this.Tracing;

        const reconstruction = await tracing.getReconstruction();

        const neuron = await reconstruction.getNeuron();

        const sample = await neuron.getSample();

        await SearchContent.destroy({where: {tracingId: tracing.id}, force: true});

        let compartments = [];

        for (const entry of this._ccfv30CompartmentMap.entries()) {
            compartments.push({
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
                visibility: 0,
                brainAreaId: entry[0],
                nodeCount: entry[1].Node,
                somaCount: entry[1].Soma,
                pathCount: entry[1].Path,
                branchCount: entry[1].Branch,
                endCount: entry[1].End
            });
        }

        await SearchContent.bulkCreate(compartments)

        this.logMessage(`inserted ${compartments.length} brain compartment stats`);

        if (compartments.length < 5) {
            compartments.map(c => {
                this.logMessage(`${c.brainAreaId}`);
                this.logMessage(`\t${c.nodeCount}`);
                this.logMessage(`\t${c.somaCount}`)
                this.logMessage(`\t${c.pathCount}`);
                this.logMessage(`\t${c.branchCount}`);
                this.logMessage(`\t${c.endCount}`);
            });
        }
    }

    private logMessage(message: any): void {
        if (this._context.logger) {
            this._context.logger(message);
        }
    }
}
