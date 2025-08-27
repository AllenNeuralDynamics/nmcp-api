export enum ReconstructionStatus {
    Unknown = 0,
    InProgress = 1,
    OnHold = 2,
    InReview = 3,
    InPeerReview = 4,
    Approved = 5,
    Rejected = 6,
    PendingStructureAssignment = 10,
    PendingSearchContents = 11,
    PendingPrecomputed = 12,
    Published = 20,
    Invalid = 99
}
