export enum QualityCheckStatus {
    NotReady = 0,
    Pending = 1,
    InProgress = 2,
    Errored = 10,
    Failed = 20,
    Complete = 30,
    CompleteWithWarnings = 34
}
