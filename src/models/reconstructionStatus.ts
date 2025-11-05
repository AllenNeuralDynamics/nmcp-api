export enum ReconstructionStatus {
    Initialized = 0,
    InProgress = 100,
    OnHold = 200,
    PeerReview = 300,
    PublishReview = 400,
    Approved = 500,                         // Approved, but can not run quality checks, node assignment, etc. for some reason
    WaitingForAtlasReconstruction = 600,    // In the process of running quality checks, node assignment, etc.
    ReadyToPublish = 700,                   // Completed running quality checks, node assignment, etc.  Ready to publish.
    Rejected = 800,
    Publishing = 900,                       // In the process of search indexing, etc.
    Published = 1000,
    Archived = 5000,
    Discarded = 10000
}
