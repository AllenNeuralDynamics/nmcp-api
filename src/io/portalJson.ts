import {AtlasNode} from "../models/atlasNode";
import {NodeStructures} from "../models/nodeStructure";
import {SpecimenNode} from "../models/specimenNode";

// Types based on the "NMCP JSON" file format.  May include legacy fields and terminology.

export type PortalJsonNode = {
    sampleNumber: number;
    parentNumber: number;
    structureIdentifier: number;
    x: number
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
    allenId: number;
}

export type PortalJsonAnnotationSpace = {
    version: number;
    description: string;
}

export type PortalJsonAtlasStructure = {
    allenId: number;
    name: string;
    safeName: string;
    acronym: string;
    structurePath: string;
    colorHex: string;
}

export type PortalJsonInjectionLabel = {
    virus: string;
    fluorophore: string;
}

export type PortalJsonCollection = {
    id: string | null;
    name: string | null;
    description: string | null;
    reference: string | null;
}

export type PortalJsonSpecimen = {
    date: string;
    subject: string;
    genotype: string;
    collection: PortalJsonCollection;
}

export type PortalJsonChunkInfo = {
    totalCount: number;
    offset: number;
    limit: number;
    hasMore: boolean;
}

export type PortalJsonReconstruction = {
    id: string;
    idString: string;
    DOI: string | null;
    sample: PortalJsonSpecimen;
    label: PortalJsonInjectionLabel | null;
    annotationSpace: PortalJsonAnnotationSpace;
    annotator: string | null;
    peerReviewer: string | null;
    proofreader: string | null;
    soma: PortalJsonNode | null;
    axonId: string | null;
    dendriteId: string | null;
    axon?: PortalJsonNode[];
    axonChunkInfo?: PortalJsonChunkInfo;
    dendrite?: PortalJsonNode[];
    dendriteChunkInfo?: PortalJsonChunkInfo;
    allenInformation?: PortalJsonAtlasStructure[];
}

export type PortalJsonReconstructionContainer = {
    comment: string;
    neurons: PortalJsonReconstruction[];
}

export function mapNodes(nodes: AtlasNode[], structureIdentifier: NodeStructures = null): PortalJsonNode[] {
    return nodes.map(n => {
        return {
            sampleNumber: n.index,
            structureIdentifier: structureIdentifier ?? n.NodeStructure.swcValue,
            x: n.x,
            y: n.y,
            z: n.z,
            radius: n.radius,
            lengthToParent: n.lengthToParent,
            parentNumber: n.parentIndex,
            allenId: n.AtlasStructure?.structureId ?? null
        }
    });
}

export function mapSpecimenNodes(nodes: SpecimenNode[], structureIdentifier: NodeStructures = null): PortalJsonNode[] {
    const sorted = [...nodes].sort((a, b) => a.index - b.index);

    const indexMap = new Map<number, number>();
    sorted.forEach((n, i) => indexMap.set(n.index, i + 1));

    return sorted.map(n => {
        return {
            sampleNumber: indexMap.get(n.index),
            structureIdentifier: structureIdentifier ?? n.NodeStructure.swcValue,
            x: n.x,
            y: n.y,
            z: n.z,
            radius: n.radius,
            lengthToParent: n.lengthToParent,
            parentNumber: n.parentIndex < 0 ? n.parentIndex : indexMap.get(n.parentIndex) ?? n.parentIndex,
            allenId: null
        }
    });
}

