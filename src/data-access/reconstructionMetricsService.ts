import {SearchIndex} from "../models/searchIndex";
import {NeuronStructure} from "../models/neuronStructure";
import {TimedFiniteMap} from "../util/timedFiniteMap";

export interface DominantStructure {
    atlasStructureId: string;
}

export interface StructureNodeCountEntry {
    atlasStructureId: string;
    nodeCount: number;
    pathCount: number;
    branchCount: number;
    endCount: number;
    nodePercentage: number;
}

export interface StructureLengthEntry {
    atlasStructureId: string;
    totalLengthMicrometer: number;
    axonLengthMicrometer: number;
    dendriteLengthMicrometer: number;
    totalLengthPercentage: number;
    axonLengthPercentage: number;
    dendriteLengthPercentage: number;
}

export interface DetailedMetricsEntry {
    atlasStructureId: string;
    neuronStructureId: string;
    nodeCount: number;
    pathCount: number;
    branchCount: number;
    endCount: number;
    totalLengthMicrometer: number;
    axonLengthMicrometer: number;
    dendriteLengthMicrometer: number;
    nodePercentage: number;
    totalLengthPercentage: number;
    axonLengthPercentage: number;
    dendriteLengthPercentage: number;
}

export interface NodeCountMetrics {
    totalNodeCount: number;
    totalPathCount: number;
    totalBranchCount: number;
    totalEndCount: number;
    byStructure: StructureNodeCountEntry[];
    dominantNodeStructures: DominantStructure[];
    dominantAxonNodeStructures: DominantStructure[];
    dominantDendriteNodeStructures: DominantStructure[];
}

export interface LengthMetrics {
    totalLengthMicrometer: number;
    totalAxonLengthMicrometer: number;
    totalDendriteLengthMicrometer: number;
    byStructure: StructureLengthEntry[];
    dominantLengthStructures: DominantStructure[];
    dominantAxonLengthStructures: DominantStructure[];
    dominantDendriteLengthStructures: DominantStructure[];
}

export interface ReconstructionMetrics {
    reconstructionId: string;
    nodeCounts: NodeCountMetrics;
    lengths: LengthMetrics;
    detailedEntries: DetailedMetricsEntry[];
}

interface AggregatedStructure {
    atlasStructureId: string;
    nodeCount: number;
    pathCount: number;
    branchCount: number;
    endCount: number;
    totalLengthMicrometer: number;
    axonLengthMicrometer: number;
    dendriteLengthMicrometer: number;
    axonNodeCount: number;
    dendriteNodeCount: number;
}

export interface SearchIndexEntry {
    nodeCount: number;
    pathCount: number;
    branchCount: number;
    endCount: number;
    totalLengthMicrometer: number;
    axonLengthMicrometer: number;
    dendriteLengthMicrometer: number;
    neuronStructureId: string;
    atlasStructureId: string;
}

function findDominant<T>(items: T[], valueAccessor: (item: T) => number, toStructure: (item: T) => DominantStructure): DominantStructure[] {
    if (items.length === 0) {
        return [];
    }

    const maxValue = Math.max(...items.map(valueAccessor));

    if (maxValue <= 0) {
        return [];
    }

    return items.filter(item => valueAccessor(item) === maxValue).map(toStructure);
}

export interface StructureIds {
    axonStructureId: string;
    dendriteStructureId: string;
}

export function computeMetrics(reconstructionId: string, entries: SearchIndexEntry[], structureIds: StructureIds): ReconstructionMetrics | null {
    if (entries.length === 0) {
        return null;
    }

    const {axonStructureId, dendriteStructureId} = structureIds;

    const aggregationMap = new Map<string, AggregatedStructure>();

    let totalNodeCount = 0;
    let totalPathCount = 0;
    let totalBranchCount = 0;
    let totalEndCount = 0;
    let totalLengthMicrometer = 0;
    let totalAxonLengthMicrometer = 0;
    let totalDendriteLengthMicrometer = 0;

    for (const entry of entries) {
        totalNodeCount += entry.nodeCount;
        totalPathCount += entry.pathCount;
        totalBranchCount += entry.branchCount;
        totalEndCount += entry.endCount;
        totalLengthMicrometer += entry.totalLengthMicrometer;
        totalAxonLengthMicrometer += entry.axonLengthMicrometer;
        totalDendriteLengthMicrometer += entry.dendriteLengthMicrometer;

        let agg = aggregationMap.get(entry.atlasStructureId);

        if (!agg) {
            agg = {
                atlasStructureId: entry.atlasStructureId,
                nodeCount: 0,
                pathCount: 0,
                branchCount: 0,
                endCount: 0,
                totalLengthMicrometer: 0,
                axonLengthMicrometer: 0,
                dendriteLengthMicrometer: 0,
                axonNodeCount: 0,
                dendriteNodeCount: 0,
            };
            aggregationMap.set(entry.atlasStructureId, agg);
        }

        agg.nodeCount += entry.nodeCount;
        agg.pathCount += entry.pathCount;
        agg.branchCount += entry.branchCount;
        agg.endCount += entry.endCount;
        agg.totalLengthMicrometer += entry.totalLengthMicrometer;
        agg.axonLengthMicrometer += entry.axonLengthMicrometer;
        agg.dendriteLengthMicrometer += entry.dendriteLengthMicrometer;

        if (entry.neuronStructureId === axonStructureId) {
            agg.axonNodeCount += entry.nodeCount;
        } else if (entry.neuronStructureId === dendriteStructureId) {
            agg.dendriteNodeCount += entry.nodeCount;
        }
    }

    const aggregated = Array.from(aggregationMap.values());

    const toDominant = (agg: AggregatedStructure): DominantStructure => ({
        atlasStructureId: agg.atlasStructureId,
    });

    const byStructureNodeCount: StructureNodeCountEntry[] = aggregated
        .sort((left, right) => right.nodeCount - left.nodeCount)
        .map(agg => ({
            atlasStructureId: agg.atlasStructureId,
            nodeCount: agg.nodeCount,
            pathCount: agg.pathCount,
            branchCount: agg.branchCount,
            endCount: agg.endCount,
            nodePercentage: totalNodeCount > 0 ? (agg.nodeCount / totalNodeCount) * 100 : 0,
        }));

    const byStructureLength: StructureLengthEntry[] = [...aggregated]
        .sort((left, right) => right.totalLengthMicrometer - left.totalLengthMicrometer)
        .map(agg => ({
            atlasStructureId: agg.atlasStructureId,
            totalLengthMicrometer: agg.totalLengthMicrometer,
            axonLengthMicrometer: agg.axonLengthMicrometer,
            dendriteLengthMicrometer: agg.dendriteLengthMicrometer,
            totalLengthPercentage: totalLengthMicrometer > 0 ? (agg.totalLengthMicrometer / totalLengthMicrometer) * 100 : 0,
            axonLengthPercentage: totalAxonLengthMicrometer > 0 ? (agg.axonLengthMicrometer / totalAxonLengthMicrometer) * 100 : 0,
            dendriteLengthPercentage: totalDendriteLengthMicrometer > 0 ? (agg.dendriteLengthMicrometer / totalDendriteLengthMicrometer) * 100 : 0,
        }));

    const axonAggregated = aggregated.filter(agg => agg.axonNodeCount > 0);
    const dendriteAggregated = aggregated.filter(agg => agg.dendriteNodeCount > 0);

    const nodeCounts: NodeCountMetrics = {
        totalNodeCount,
        totalPathCount,
        totalBranchCount,
        totalEndCount,
        byStructure: byStructureNodeCount,
        dominantNodeStructures: findDominant(aggregated, agg => agg.nodeCount, toDominant),
        dominantAxonNodeStructures: findDominant(axonAggregated, agg => agg.axonNodeCount, toDominant),
        dominantDendriteNodeStructures: findDominant(dendriteAggregated, agg => agg.dendriteNodeCount, toDominant),
    };

    const axonLengthAggregated = aggregated.filter(agg => agg.axonLengthMicrometer > 0);
    const dendriteLengthAggregated = aggregated.filter(agg => agg.dendriteLengthMicrometer > 0);

    const lengths: LengthMetrics = {
        totalLengthMicrometer,
        totalAxonLengthMicrometer,
        totalDendriteLengthMicrometer,
        byStructure: byStructureLength,
        dominantLengthStructures: findDominant(aggregated, agg => agg.totalLengthMicrometer, toDominant),
        dominantAxonLengthStructures: findDominant(axonLengthAggregated, agg => agg.axonLengthMicrometer, toDominant),
        dominantDendriteLengthStructures: findDominant(dendriteLengthAggregated, agg => agg.dendriteLengthMicrometer, toDominant),
    };

    const detailedEntries: DetailedMetricsEntry[] = entries
        .sort((left, right) => right.nodeCount - left.nodeCount)
        .map(entry => ({
            atlasStructureId: entry.atlasStructureId,
            neuronStructureId: entry.neuronStructureId,
            nodeCount: entry.nodeCount,
            pathCount: entry.pathCount,
            branchCount: entry.branchCount,
            endCount: entry.endCount,
            totalLengthMicrometer: entry.totalLengthMicrometer,
            axonLengthMicrometer: entry.axonLengthMicrometer,
            dendriteLengthMicrometer: entry.dendriteLengthMicrometer,
            nodePercentage: totalNodeCount > 0 ? (entry.nodeCount / totalNodeCount) * 100 : 0,
            totalLengthPercentage: totalLengthMicrometer > 0 ? (entry.totalLengthMicrometer / totalLengthMicrometer) * 100 : 0,
            axonLengthPercentage: totalAxonLengthMicrometer > 0 ? (entry.axonLengthMicrometer / totalAxonLengthMicrometer) * 100 : 0,
            dendriteLengthPercentage: totalDendriteLengthMicrometer > 0 ? (entry.dendriteLengthMicrometer / totalDendriteLengthMicrometer) * 100 : 0,
        }));

    return {
        reconstructionId,
        nodeCounts,
        lengths,
        detailedEntries,
    };
}

const CACHE_SIZE = 100;
const CACHE_TTL_MS = parseInt(process.env.NMCP_METRICS_CACHE_TTL_MS) || 3_600_000;

const metricsCache = new TimedFiniteMap<string, ReconstructionMetrics>(CACHE_SIZE, CACHE_TTL_MS);

export async function getReconstructionMetrics(reconstructionId: string): Promise<ReconstructionMetrics | null> {
    const cached = metricsCache.getTimed(reconstructionId);

    if (cached) {
        return cached;
    }

    const entries = await SearchIndex.findAll({
        where: {reconstructionId},
    });

    const result = computeMetrics(reconstructionId, entries, {
        axonStructureId: NeuronStructure.AxonStructureId,
        dendriteStructureId: NeuronStructure.DendriteStructureId,
    });

    if (result) {
        metricsCache.setTimed(reconstructionId, result);
    }

    return result;
}
