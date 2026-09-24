import {
    PausableSourceStatuses,
    ResumableSourceStatuses,
    ReviewRequestSourceStatuses,
    UntraceableSourceStatuses
} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";

/**
 * The model list each import target is held to.  InProgress is absent because that target makes no transition at all;
 * a held reconstruction is refused it anyway, by the terminal rule in importMayTransition.  Approved shares
 * ReviewRequestSourceStatuses because the imports reach it by parking at PublishReview first and approving after the
 * upload.  Duplicate is listed although SmartSheet never asks for it, so that the guard mirrors the model for every
 * hold target rather than admitting one by default.
 */
const importTransitionSourceStatuses: ReadonlyMap<ReconstructionStatus, ReconstructionStatus[]> = new Map([
    [ReconstructionStatus.OnHold, PausableSourceStatuses],
    [ReconstructionStatus.Incomplete, PausableSourceStatuses],
    [ReconstructionStatus.Duplicate, PausableSourceStatuses],
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
 * The hold rules are the import's own, stricter than the portal's.  A sheet hold value means the reconstruction is held
 * now, and the only expected way out is the annotator resuming it in the portal, so a held reconstruction is refused
 * every target: no transition and no metadata refresh.  A hold target is admitted only for a reconstruction the run
 * created; an existing reconstruction keeps its status whatever the sheet says, which is what stops the next run
 * re-holding one the annotator resumed.  createdThisRun defaults to false so that a caller which doesn't know never
 * applies a hold.  Both refusals must precede the map lookup and the parking exemption.
 *
 * Its own module because both import tools are CLI entry points that start an import on load, so nothing can require
 * them - including a test.
 */
export function importMayTransition(currentStatus: ReconstructionStatus, targetStatus: ReconstructionStatus, createdThisRun: boolean = false): boolean {
    if (ResumableSourceStatuses.includes(currentStatus)) {
        return false;
    }

    if (ResumableSourceStatuses.includes(targetStatus) && !createdThisRun) {
        return false;
    }

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
