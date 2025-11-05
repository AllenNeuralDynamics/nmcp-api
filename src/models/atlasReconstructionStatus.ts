export enum AtlasReconstructionStatus {
    Initialized = 0,
    ReadyToProcess = 100,
    PendingRegistration = 200,
    InRegistration = 220,
    FailedRegistration = 240,
    PendingQualityControl = 300,
    InQualityControl = 320,
    FailedQualityControl = 340,
    PendingStructureAssignment = 400,
    InStructureAssignment = 420,
    FailedStructureAssignment = 440,
    PendingPrecomputed = 500,
    InPrecomputed = 540,
    FailedPrecomputed = 580,
    ReadyToPublish = 600,
    PendingSearchIndexing = 700,
    InSearchIndexing = 720,
    FailedSearchIndexing = 740,
    Published = 1000,
    Discarded = 2000
}

export const QualityControlStatusKinds: AtlasReconstructionStatus[] = [
    AtlasReconstructionStatus.PendingQualityControl,
    AtlasReconstructionStatus.InQualityControl,
    AtlasReconstructionStatus.FailedQualityControl
];

export const PrecomputedStatusKinds: AtlasReconstructionStatus[] = [
    AtlasReconstructionStatus.PendingPrecomputed,
    AtlasReconstructionStatus.InPrecomputed,
    AtlasReconstructionStatus.FailedPrecomputed
];
