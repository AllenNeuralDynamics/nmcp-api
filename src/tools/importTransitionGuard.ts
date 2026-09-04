import {
    PausableSourceStatuses,
    ReviewRequestSourceStatuses,
    UntraceableSourceStatuses
} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";

/**
 * The model list each import target is held to.  InProgress is absent because that target makes no transition at all.
 * Approved shares ReviewRequestSourceStatuses because the imports reach it by parking at PublishReview first and
 * approving after the upload.
 */
const importTransitionSourceStatuses: ReadonlyMap<ReconstructionStatus, ReconstructionStatus[]> = new Map([
    [ReconstructionStatus.OnHold, PausableSourceStatuses],
    [ReconstructionStatus.PublishReview, ReviewRequestSourceStatuses],
    [ReconstructionStatus.Approved, ReviewRequestSourceStatuses],
    [ReconstructionStatus.Untraceable, UntraceableSourceStatuses]
]);

/**
 * Whether an import may still make the transition a row asks for.  Mirrors the model's own guard so that a row the
 * portal has moved on is skipped and reported by the tool rather than throwing from inside it: SmartSheet's per-row
 * catch only writes a debug line, and the metadata update and the atlas upload both sit on that path.
 *
 * The PublishReview exemption is requestReview's parking no-op and must match it: both review targets park by calling
 * requestReview(PublishReview), so a row a previous run left there is finished on this one rather than skipped.
 *
 * Its own module because both import tools are CLI entry points that start an import on load, so nothing can require
 * them - including a test.
 */
export function importMayTransition(currentStatus: ReconstructionStatus, targetStatus: ReconstructionStatus): boolean {
    const sourceStatuses = importTransitionSourceStatuses.get(targetStatus);

    if (sourceStatuses === undefined) {
        return true;
    }

    const isParkingTarget = targetStatus == ReconstructionStatus.PublishReview || targetStatus == ReconstructionStatus.Approved;

    if (isParkingTarget && currentStatus == ReconstructionStatus.PublishReview) {
        return true;
    }

    return sourceStatuses.includes(currentStatus);
}
