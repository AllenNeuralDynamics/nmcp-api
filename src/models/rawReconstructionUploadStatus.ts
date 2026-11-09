export enum RawReconstructionUploadStatus {
    // No longer written; kept for attempts that already carry it.
    Uploading = 100,
    PendingQualityControl = 200,
    FailedUpload = 300,
    FailedPrecomputed = 320,
    FailedQualityControl = 400,
    ErroredQualityControl = 410,
    FailedQualityControlService = 420,
    Accepted = 500
}

export const TerminalRawUploadStatuses: RawReconstructionUploadStatus[] = [
    RawReconstructionUploadStatus.FailedUpload,
    RawReconstructionUploadStatus.FailedPrecomputed,
    RawReconstructionUploadStatus.FailedQualityControl,
    RawReconstructionUploadStatus.ErroredQualityControl,
    RawReconstructionUploadStatus.FailedQualityControlService,
    RawReconstructionUploadStatus.Accepted
];
