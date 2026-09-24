export enum ReconstructionStatus {
    InProgress = 100,
    OnHold = 200,
    Incomplete = 210,                       // A hold, as OnHold is: left only by resumeReconstruction.
    Duplicate = 220,                        // A hold, as OnHold is: left only by resumeReconstruction.
    PeerReview = 300,
    TeamReview = 350,                       // Optional stage between peer and publish review.
    PublishReview = 400,
    Approved = 500,                         // Approved, but can not run quality checks, node assignment, etc. for some reason
    WaitingForAtlasReconstruction = 600,    // In the process of running quality checks, node assignment, etc.
    ReadyToPublish = 700,                   // Completed running quality checks, node assignment, etc.  Ready to publish.
    Rejected = 800,
    Publishing = 900,                       // In the process of search indexing, etc.
    Published = 1000,
    PublishFailed = 1100,                   // Search indexing failed; recovery is forward-only through requestSearchIndexing.
    Archived = 5000,
    Untraceable = 6000,
    Discarded = 10000
}
