export enum ReconstructionStatus {
    Unknown = 0,
    InProgress = 1,
    OnHold = 2,
    InReview = 3,
    InPeerReview = 4,
    Approved = 5,
    ApprovedAndReady = 6,
    Rejected = 7,
    PendingStructureAssignment = 10,
    PendingSearchContents = 11,
    PendingPrecomputed = 12,
    Published = 20,
    Archived = 30,
    Invalid = 99
}
