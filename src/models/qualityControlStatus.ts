export enum QualityControlStatus {
    NotReady = 0,
    Pending = 100,
    // The worker's claim: selected by getPending and being assessed right now.
    InProgress = 200,
    Error = 300,
    Failed = 400,
    Passed = 500
}
