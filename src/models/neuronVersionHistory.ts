import {Op} from "sequelize";

import {EventLogItem, EventLogItemKind} from "./eventLogItem";
import {Neuron} from "./neuron";
import {Reconstruction} from "./reconstruction";
import {AtlasReconstruction} from "./atlasReconstruction";

export type VersionHistoryEvent = EventLogItem;

export type NeuronVersionHistoryBranch = {
    reconstructionId: string;
    status: number;
    startedAt: Date;
    events: VersionHistoryEvent[];
}

export type NeuronVersionHistory = {
    neuronId: string;
    trunk: VersionHistoryEvent[];
    branches: NeuronVersionHistoryBranch[];
}

export async function getNeuronVersionHistory(neuronId: string): Promise<NeuronVersionHistory> {
    const neuron = await Neuron.findByPk(neuronId);

    if (!neuron) {
        throw new Error(`Neuron ${neuronId} not found`);
    }

    const reconstructions = await Reconstruction.findAll({
        where: {neuronId},
        paranoid: false
    });

    const reconstructionIds = reconstructions.map(rec => rec.id);

    const atlasReconstructions = reconstructionIds.length > 0
        ? await AtlasReconstruction.findAll({
            where: {reconstructionId: {[Op.in]: reconstructionIds}},
            paranoid: false
        })
        : [];

    const atlasReconstructionIds = atlasReconstructions.map(ar => ar.id);

    const reconstructionToAtlasMap = new Map<string, string[]>();
    for (const atlasRec of atlasReconstructions) {
        const existing = reconstructionToAtlasMap.get(atlasRec.reconstructionId) || [];
        existing.push(atlasRec.id);
        reconstructionToAtlasMap.set(atlasRec.reconstructionId, existing);
    }

    const [trunkEvents, reconstructionEvents, reconstructionChildEvents, atlasChildEvents] = await Promise.all([
        EventLogItem.findAll({
            where: {
                targetId: neuronId,
                kind: {[Op.between]: [EventLogItemKind.NeuronCreate, EventLogItemKind.NeuronDelete]}
            },
            order: [["createdAt", "ASC"]]
        }),

        reconstructionIds.length > 0
            ? EventLogItem.findAll({
                where: {
                    parentId: neuronId,
                    kind: {[Op.between]: [EventLogItemKind.ReconstructionCreate, EventLogItemKind.ReconstructionArchive]}
                },
                order: [["createdAt", "ASC"]]
            })
            : [],

        reconstructionIds.length > 0
            ? EventLogItem.findAll({
                where: {
                    parentId: {[Op.in]: reconstructionIds},
                    kind: {[Op.gte]: EventLogItemKind.AtlasReconstructionCreate}
                },
                order: [["createdAt", "ASC"]]
            })
            : [],

        atlasReconstructionIds.length > 0
            ? EventLogItem.findAll({
                where: {
                    parentId: {[Op.in]: atlasReconstructionIds},
                    kind: {[Op.gte]: EventLogItemKind.QualityControlCreate}
                },
                order: [["createdAt", "ASC"]]
            })
            : []
    ]);

    const reconstructionEventsByTarget = new Map<string, EventLogItem[]>();
    for (const event of reconstructionEvents) {
        const targetId = event.targetId;
        const existing = reconstructionEventsByTarget.get(targetId) || [];
        existing.push(event);
        reconstructionEventsByTarget.set(targetId, existing);
    }

    const eventsByParentReconstruction = new Map<string, EventLogItem[]>();
    for (const event of reconstructionChildEvents) {
        const parentId = (event as any).parentId as string;
        const existing = eventsByParentReconstruction.get(parentId) || [];
        existing.push(event);
        eventsByParentReconstruction.set(parentId, existing);
    }

    const eventsByAtlasReconstruction = new Map<string, EventLogItem[]>();
    for (const event of atlasChildEvents) {
        const parentId = (event as any).parentId as string;
        const existing = eventsByAtlasReconstruction.get(parentId) || [];
        existing.push(event);
        eventsByAtlasReconstruction.set(parentId, existing);
    }

    const branches: NeuronVersionHistoryBranch[] = reconstructions.map(rec => {
        const branchEvents: EventLogItem[] = [];

        const recEvents = reconstructionEventsByTarget.get(rec.id) || [];
        branchEvents.push(...recEvents);

        const childEvents = eventsByParentReconstruction.get(rec.id) || [];
        branchEvents.push(...childEvents);

        const atlasIds = reconstructionToAtlasMap.get(rec.id) || [];
        for (const atlasId of atlasIds) {
            const atlasEvents = eventsByAtlasReconstruction.get(atlasId) || [];
            branchEvents.push(...atlasEvents);
        }

        branchEvents.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

        return {
            reconstructionId: rec.id,
            status: rec.status,
            startedAt: rec.startedAt,
            events: branchEvents
        };
    });

    branches.sort((left, right) => {
        const leftTime = left.startedAt?.getTime() ?? 0;
        const rightTime = right.startedAt?.getTime() ?? 0;
        return leftTime - rightTime;
    });

    return {
        neuronId,
        trunk: trunkEvents,
        branches
    };
}
