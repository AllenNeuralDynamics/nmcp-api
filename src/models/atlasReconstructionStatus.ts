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
    PendingDoiAssignment = 585,
    InDoiAssignment = 590,
    FailedDoiAssignment = 595,
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

export const DoiAssignmentStatusKinds: AtlasReconstructionStatus[] = [
    AtlasReconstructionStatus.PendingDoiAssignment,
    AtlasReconstructionStatus.InDoiAssignment,
    AtlasReconstructionStatus.FailedDoiAssignment
];

/**
 * The claim a worker phase writes while it holds an item, and the status a released claim returns to.
 *
 * InPrecomputed is deliberately absent: precomputed generation is answered asynchronously by the precomputed
 * service, so a row sitting there is in flight in another process and resetting it would re-request work already
 * running.  InRegistration is absent because registration into atlas space is a manual upload, not a phase.
 */
export const ClaimedPhaseStatuses: ReadonlyMap<AtlasReconstructionStatus, AtlasReconstructionStatus> = new Map([
    [AtlasReconstructionStatus.InQualityControl, AtlasReconstructionStatus.PendingQualityControl],
    [AtlasReconstructionStatus.InStructureAssignment, AtlasReconstructionStatus.PendingStructureAssignment],
    [AtlasReconstructionStatus.InDoiAssignment, AtlasReconstructionStatus.PendingDoiAssignment],
    [AtlasReconstructionStatus.InSearchIndexing, AtlasReconstructionStatus.PendingSearchIndexing]
]);

// What the derived phaseFailure field treats as a blocked phase.
export const PhaseFailureStatuses: AtlasReconstructionStatus[] = [
    AtlasReconstructionStatus.FailedQualityControl,
    AtlasReconstructionStatus.FailedStructureAssignment,
    AtlasReconstructionStatus.FailedPrecomputed,
    AtlasReconstructionStatus.FailedDoiAssignment,
    AtlasReconstructionStatus.FailedSearchIndexing
];

/**
 * The failed phases a reconstruction may be abandoned or replayed from.  FailedSearchIndexing is absent: it reports a
 * problem with the indexing process rather than with the reconstruction, and requestSearchIndexing is its only remedy.
 */
export const AbandonableFailureStatuses: AtlasReconstructionStatus[] = [
    AtlasReconstructionStatus.FailedQualityControl,
    AtlasReconstructionStatus.FailedStructureAssignment,
    AtlasReconstructionStatus.FailedPrecomputed,
    AtlasReconstructionStatus.FailedDoiAssignment
];
