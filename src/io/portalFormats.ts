export type PortalNode = {
    index: number;
    structure: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    parentIndex: number;
    atlasStructure?: number;
}

export type PortalInjection = {
    virus: string | null;
    fluorophore: string | null;
}

export type PortalCollection = {
    name: string | null;
    description: string | null;
    reference: string | null;
}

export enum PortalAnnotationSpace {
    Specimen = 0,
    Atlas = 1
}

export type PortalSpecimen = {
    label: string;
    date: number | null;
    genotype: string | null;
    collection: PortalCollection;
    injections: PortalInjection[];
}

export type PortalNeuron = {
    label: string;
    specimen: PortalSpecimen;
}

export type PortalUser = {
    displayName: string;
    affiliation: string;
    email: string;
}

export type PortalReconstruction = {
    id: string;
    annotationSpace: PortalAnnotationSpace;
    neuron: PortalNeuron;
    annotator: PortalUser | null;
    peerReviewer: PortalUser | null;
    proofreader: PortalUser | null;
    nodes: PortalNode[];
}