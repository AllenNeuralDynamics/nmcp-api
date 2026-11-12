// A leaf module so the notification module can read it without importing accessRequest.ts, which imports it.
export enum AccessRequestKind {
    Access = 0,
    Feedback = 100
}
