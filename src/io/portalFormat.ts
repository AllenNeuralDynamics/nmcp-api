export type PortalNode = {
    index: number;
    structure: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    parentIndex: number;
    atlasStructure?: number | null;
    lengthToParent?: number | null;
}

export type PortalInjection = {
    virus: string | null;
    fluorophore: string | null;
}

export type PortalCollection = {
    id: string
    name: string | null;
    description: string | null;
    reference: string | null;
}

export enum PortalAnnotationSpace {
    Specimen = 100,
    Atlas = 200
}

export type PortalSpecimen = {
    id: string
    label: string;
    date: number | null;
    genotype: string | null;
    collection: PortalCollection;
    injections: PortalInjection[];
}

export type PortalNeuron = {
    id: string
    label: string;
    specimen: PortalSpecimen;
}

export type PortalUser = {
    id: string
    displayName: string;
    affiliation: string;
    email: string;
}

export type PortalReconstruction = {
    id: string;
    annotationSpace: PortalAnnotationSpace;
    doi: string | null;
    neuron: PortalNeuron;
    annotator: PortalUser | null;
    peerReviewer: PortalUser | null;
    proofreader: PortalUser | null;
    nodes: PortalNode[];
}