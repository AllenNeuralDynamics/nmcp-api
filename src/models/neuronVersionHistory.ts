import {Op} from "sequelize";

import {EventLogItem, EventLogItemKind, RawReconstructionEventKindRange} from "./eventLogItem";
import {Neuron} from "./neuron";
import {Annotation} from "./annotation";
import {AtlasReconstruction} from "./atlasReconstruction";
import {SpecimenSpaceReconstruction} from "./specimenSpaceReconstruction";

export type VersionHistoryEvent = EventLogItem;

export type NeuronVersionHistoryBranch = {
    annotationId: string;
    status: number;
    startedAt: Date;
    events: VersionHistoryEvent[];
}

export type NeuronVersionHistory = {
    neuronId: string;
    specimen: VersionHistoryEvent[];
    trunk: VersionHistoryEvent[];
    branches: NeuronVersionHistoryBranch[];
}

export async function getNeuronVersionHistory(neuronId: string): Promise<NeuronVersionHistory> {
    const neuron = await Neuron.findByPk(neuronId);

    if (!neuron) {
        throw new Error(`Neuron ${neuronId} not found`);
    }

    const annotations = await Annotation.findAll({
        where: {neuronId},
        paranoid: false
    });

    const annotationIds = annotations.map(annotation => annotation.id);

    const specimenSpaceReconstructions = annotationIds.length > 0
        ? await SpecimenSpaceReconstruction.findAll({
            where: {annotationId: {[Op.in]: annotationIds}},
            attributes: ["id", "annotationId"],
            paranoid: false
        })
        : [];

    const atlasReconstructions = annotationIds.length > 0
        ? await AtlasReconstruction.findAll({
            where: {annotationId: {[Op.in]: annotationIds}},
            paranoid: false
        })
        : [];

    const atlasReconstructionIds = atlasReconstructions.map(ar => ar.id);

    const annotationToAtlasMap = new Map<string, string[]>();
    for (const atlasRec of atlasReconstructions) {
        const existing = annotationToAtlasMap.get(atlasRec.annotationId) || [];
        existing.push(atlasRec.id);
        annotationToAtlasMap.set(atlasRec.annotationId, existing);
    }

    // On rows that existed before the split the specimen-space id is the annotation id; the Map keeps the parent list
    // free of duplicates, so no event is fetched twice.
    const branchByParentId = new Map<string, string>();
    for (const annotationId of annotationIds) {
        branchByParentId.set(annotationId, annotationId);
    }
    for (const specimenSpaceReconstruction of specimenSpaceReconstructions) {
        branchByParentId.set(specimenSpaceReconstruction.id, specimenSpaceReconstruction.annotationId);
    }

    const [specimenEvents, trunkEvents, annotationEvents, annotationChildEvents, atlasChildEvents] = await Promise.all([
        EventLogItem.findAll({
            where: {
                targetId: neuron.specimenId,
                kind: {[Op.in]: [
                    EventLogItemKind.SpecimenCreate,
                    EventLogItemKind.SpecimenUpdate,
                    EventLogItemKind.SpecimenUpdateSomaProperties,
                    EventLogItemKind.SpecimenDelete,
                    EventLogItemKind.CandidatesInsert
                ]}
            },
            order: [["createdAt", "ASC"]]
        }),

        EventLogItem.findAll({
            where: {
                targetId: neuronId,
                kind: {[Op.between]: [EventLogItemKind.NeuronCreate, EventLogItemKind.NeuronDelete]}
            },
            order: [["createdAt", "ASC"]]
        }),

        annotationIds.length > 0
            ? EventLogItem.findAll({
                where: {
                    parentId: neuronId,
                    kind: {[Op.between]: [EventLogItemKind.AnnotationCreate, EventLogItemKind.AnnotationArchive]}
                },
                order: [["createdAt", "ASC"]]
            })
            : [],

        // One query for the atlas, specimen-space and specimen precomputed events: the first two are parented by the
        // annotation, the last by the specimen-space row.  Raw reconstruction events are parented by the annotation too
        // and excluded by design: a raw reconstruction is supporting data, not a version of the neuron.
        annotationIds.length > 0
            ? EventLogItem.findAll({
                where: {
                    parentId: {[Op.in]: [...branchByParentId.keys()]},
                    kind: {[Op.gte]: EventLogItemKind.AtlasReconstructionCreate, [Op.notBetween]: [...RawReconstructionEventKindRange]}
                },
                order: [["createdAt", "ASC"]]
            })
            : [],

        atlasReconstructionIds.length > 0
            ? EventLogItem.findAll({
                where: {
                    parentId: {[Op.in]: atlasReconstructionIds},
                    kind: {[Op.gte]: EventLogItemKind.AtlasQualityControlCreate}
                },
                order: [["createdAt", "ASC"]]
            })
            : []
    ]);

    const annotationEventsByTarget = new Map<string, EventLogItem[]>();
    for (const event of annotationEvents) {
        const targetId = event.targetId;
        const existing = annotationEventsByTarget.get(targetId) || [];
        existing.push(event);
        annotationEventsByTarget.set(targetId, existing);
    }

    const eventsByParentAnnotation = new Map<string, EventLogItem[]>();
    for (const event of annotationChildEvents) {
        const branchId = branchByParentId.get((event as any).parentId as string);
        const existing = eventsByParentAnnotation.get(branchId) || [];
        existing.push(event);
        eventsByParentAnnotation.set(branchId, existing);
    }

    const eventsByAtlasReconstruction = new Map<string, EventLogItem[]>();
    for (const event of atlasChildEvents) {
        const parentId = (event as any).parentId as string;
        const existing = eventsByAtlasReconstruction.get(parentId) || [];
        existing.push(event);
        eventsByAtlasReconstruction.set(parentId, existing);
    }

    const branches: NeuronVersionHistoryBranch[] = annotations.map(annotation => {
        const branchEvents: EventLogItem[] = [];

        const ownEvents = annotationEventsByTarget.get(annotation.id) || [];
        branchEvents.push(...ownEvents);

        const childEvents = eventsByParentAnnotation.get(annotation.id) || [];
        branchEvents.push(...childEvents);

        const atlasIds = annotationToAtlasMap.get(annotation.id) || [];
        for (const atlasId of atlasIds) {
            const atlasEvents = eventsByAtlasReconstruction.get(atlasId) || [];
            branchEvents.push(...atlasEvents);
        }

        branchEvents.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

        return {
            annotationId: annotation.id,
            status: annotation.status,
            startedAt: annotation.startedAt,
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
        specimen: specimenEvents,
        trunk: trunkEvents,
        branches
    };
}
