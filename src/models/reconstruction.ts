import * as fs from "fs";

import {
    BelongsToGetAssociationMixin,
    DataTypes,
    FindOptions,
    HasManyGetAssociationsMixin,
    HasOneGetAssociationMixin,
    Includeable,
    literal,
    Op,
    OrderItem,
    Sequelize,
    Transaction
} from "sequelize";

import {BaseModel} from "./baseModel";

import {SpecimenSpacePrecomputed} from "./specimenSpacePrecomputed";
import {mapToSpecimenNodeShape, SpecimenNode, SpecimenNodeShape} from "./specimenNode";
import {Neuron} from "./neuron";
import {UploadSourceStatuses, User} from "./user";
import {GqlFile, UnauthorizedError} from "../graphql/secureResolvers";
import {AtlasReconstructionTableName, NeuronTableName, ReconstructionTableName} from "./tableNames";
import {ReconstructionSpace} from "./reconstructionSpace";
import {Specimen} from "./specimen";
import {substringMatchPatterns} from "../util/keywords";
import {ReconstructionStatus} from "./reconstructionStatus";
import {AtlasReconstruction, AtlasReconstructionShape} from "./atlasReconstruction";
import {AbandonableFailureStatuses, AtlasReconstructionStatus} from "./atlasReconstructionStatus";
import {EventLogItemKind, recordEvent, ReviewRequestEventKinds} from "./eventLogItem";
import {isNotNullOrUndefined} from "../util/objectUtil";
import {NodeCounts, parseSwcFile, SimpleReconstruction} from "../io/simpleReconstruction";
import {parseParquetFile, parseParquetUpload} from "../io/parquetParser";
import {NeuronStructure} from "./neuronStructure";
import {Injection} from "./injection";
import {InjectionVirus} from "./injectionVirus";
import {Fluorophore} from "./fluorophore";
import {Genotype} from "./genotype";
import {Collection} from "./collection"
import {NodeStructure} from "./nodeStructure";
import {GraphQLError} from "graphql/error";
import {SearchIndex} from "./searchIndex";
import {Precomputed} from "./precomputed";
import {PortalAnnotationSpace, PortalNode, PortalReconstruction} from "../io/portalFormat";

const debug = require("debug")("nmcp:nmcp-api:reconstruction");

/**
 * Statuses at which a reconstruction is closed: findOrOpenReconstruction prefers any row outside them as the
 * annotator's open attempt, and they are the base of AnnotationLimitExemptStatuses.
 */
export const ClosedReconstructionStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.Rejected,
    ReconstructionStatus.Published,
    ReconstructionStatus.Archived,
    ReconstructionStatus.Untraceable,
    ReconstructionStatus.Discarded
];

/**
 * Statuses that do not count as an open annotation when enforcing the single-annotation limit.  Anything not listed
 * here holds the annotator's one slot.  Incomplete and Duplicate are an annotator's notation on work set aside, so they
 * free the slot without closing the reconstruction - findOrOpenReconstruction still treats them as open.  Revise this
 * list, not ClosedReconstructionStatuses, if other statuses should stop counting.
 */
export const AnnotationLimitExemptStatuses: ReconstructionStatus[] = [
    ...ClosedReconstructionStatuses,
    ReconstructionStatus.Incomplete,
    ReconstructionStatus.Duplicate
];

// The most reconstructions one publishAll call will attempt.  ALL takes the oldest 50 and the caller repeats; an
// explicit list longer than this is refused rather than partially executed.
export const PublishAllLimit = 50;

/**
 * A publish this reconstruction is not in a position to make: a sibling holds the publish, or the row moved since it
 * was selected.  The type is what separates those from an attempt that broke - a lock timeout, a failed commit, a
 * defect - because publishAll ends its run quietly on the first of these and must not do the same for the others.
 * Classified on the type rather than the message: the messages are a caller-facing contract, not a discriminator.
 */
export class PublishRefusalError extends GraphQLError {
    public constructor(message: string, code: number) {
        super(message, {extensions: {code: code}});
    }
}

/**
 * Source statuses a reconstruction may be marked untraceable from.  Only the statuses where the reconstruction is
 * still the annotator's to abandon: from peer review onwards the atlas child, its quality control row and any
 * in-flight worker batch are live state this transition destroys.
 */
export const UntraceableSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.InProgress,
    ReconstructionStatus.OnHold,
    ReconstructionStatus.Incomplete,
    ReconstructionStatus.Duplicate,
    ReconstructionStatus.Rejected
];

/**
 * Source statuses a review may be requested from, for any review target.  Rejected is InProgress with changes
 * having been asked for and carries the same rights.  No hold status - OnHold, Incomplete or Duplicate - is a source:
 * a held reconstruction resumes first.  Once in the review pipeline a reconstruction advances by approval, so no review status is a source.
 */
export const ReviewRequestSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.InProgress,
    ReconstructionStatus.Rejected
];

/**
 * Source statuses a reconstruction may be put on hold from - paused, or marked incomplete or a duplicate.  A review
 * someone else is performing, or work already queued behind an approval, is not the annotator's to suspend.
 * Membership is the same as ReviewRequestSourceStatuses today, but the two are separate rules: a change to one is not
 * a change to the other.
 */
export const PausableSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.InProgress,
    ReconstructionStatus.Rejected
];

/**
 * Source statuses resumeReconstruction returns to InProgress: every hold.  A hold is left only this way - there is no
 * move from one hold to another - and the import tools rely on that: importMayTransition treats a reconstruction at
 * any of these as out of the import's reach, and applies one only to a reconstruction the run created.
 */
export const ResumableSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.OnHold,
    ReconstructionStatus.Incomplete,
    ReconstructionStatus.Duplicate
];

/**
 * Source statuses an annotator (or an admin) may discard from.
 */
export const DiscardableSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.InProgress,
    ReconstructionStatus.OnHold,
    ReconstructionStatus.Incomplete,
    ReconstructionStatus.Duplicate,
    ReconstructionStatus.Rejected
];

/**
 * Source statuses only an admin may discard from.  From Approved onwards - through every automatic phase, Publishing
 * and the terminal statuses - no one may discard, so those appear in neither list.
 */
export const AdminDiscardableSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.PeerReview,
    ReconstructionStatus.TeamReview,
    ReconstructionStatus.PublishReview
];

/**
 * Source statuses a reconstruction may be rejected from regardless of the child.  WaitingForAtlasReconstruction is
 * absent because it depends on the child having stopped at a failed phase - see AbandonableFailureStatuses.
 */
export const RejectableSourceStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.PeerReview,
    ReconstructionStatus.TeamReview,
    ReconstructionStatus.PublishReview,
    ReconstructionStatus.ReadyToPublish
];

/**
 * The source statuses each approval target requires.  Approval applies only to a reconstruction that has asked for it:
 * holding the permission, explicitly as a reviewer or implicitly as an admin, is not licence to jump the line.  A
 * target absent from this map is not an approval target at all.  A target may have more than one source: team review
 * is optional, so PublishReview is reached by a sign-off from either of the two stages before it.
 */
export const ApprovalSourceStatuses: ReadonlyMap<ReconstructionStatus, ReconstructionStatus[]> = new Map([
    [ReconstructionStatus.TeamReview, [ReconstructionStatus.PeerReview]],
    [ReconstructionStatus.PublishReview, [ReconstructionStatus.PeerReview, ReconstructionStatus.TeamReview]],
    [ReconstructionStatus.Approved, [ReconstructionStatus.PublishReview]]
]);

/**
 * Reconstruction statuses that hold a neuron out of the candidate pool when only a finished publication counts
 * (getCandidateNeurons with includeInProgress).  Publishing is included: the reconstruction is mid-publish and in
 * transition to published.  PublishFailed likewise - a half-published reconstruction whose predecessor is already
 * archived and de-indexed is not a candidate either, and its retry is the only thing that finishes it.
 */
export const PublishedCandidateBlockingStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.Publishing,
    ReconstructionStatus.PublishFailed,
    ReconstructionStatus.Published
];

/**
 * Reconstruction statuses that hold a neuron out of the candidate pool when live work counts as well (the default).
 * OnHold, Incomplete, Duplicate and Archived are absent deliberately: a held reconstruction releases its neuron - a hold
 * is the annotator's notation, not a verdict on the neuron - and an archived one is not a live published version.  Untraceable and Discarded are absent because those rows are soft-deleted and never
 * reach the query; Neuron.untraceable is what surfaces them.
 */
export const CandidateBlockingStatuses: ReconstructionStatus[] = [
    ReconstructionStatus.InProgress,
    ReconstructionStatus.PeerReview,
    ReconstructionStatus.TeamReview,
    ReconstructionStatus.PublishReview,
    ReconstructionStatus.Approved,
    ReconstructionStatus.WaitingForAtlasReconstruction,
    ReconstructionStatus.ReadyToPublish,
    ReconstructionStatus.Rejected,
    ...PublishedCandidateBlockingStatuses
];

export type ReconstructionStatusFilter = {
    status: ReconstructionStatus;
    atlasStatus?: AtlasReconstructionStatus[];
}

export type ReconstructionsQueryArgs = {
    status: ReconstructionStatus[];
    statusFilters?: ReconstructionStatusFilter[];
    offset: number;
    limit: number;
    userOnly?: boolean;
    userId?: string;
    specimenIds?: string[];
    keywords?: string[];
}

export type ReconstructionQueryResponse = {
    total: number;
    offset: number;
    reconstructions: Reconstruction[];
}

export type PublishedReconstructionQueryResponse = {
    total: number;
    offset: number;
    reconstructions: AtlasReconstruction[];
}

export type ReviewRequestArgs = {
    reconstructionId: string
    targetStatus: ReconstructionStatus.PeerReview | ReconstructionStatus.TeamReview | ReconstructionStatus.PublishReview;
    duration?: number;
    notes?: string;
}

export type ReconstructionMetadataArgs = {
    reconstructionId: string;
    duration?: number;
    notes?: string;
    started?: Date;
    completed?: Date;
}

export type ReconstructionUploadArgs = {
    reconstructionId: string;
    reconstructionSpace: ReconstructionSpace
    file: Promise<GqlFile>;
}

export enum ReconstructionRevisionKind {
    SpecimenSpace = 0,
    AtlasSpace = 1
}

type HoldTransition = {
    status: ReconstructionStatus;
    eventKind: EventLogItemKind;
    refusal: (currentStatusName: string) => string;
};

class UploadError extends Error {
    public constructor(message: string) {
        super(message);
    }
}

class NotFoundError extends Error {
    public constructor(message: string) {
        super(message);
    }
}

type ReconstructionShape = {
    id?: string;
    sourceUrl?: string;
    sourceComments?: string;
    status?: ReconstructionStatus;
    notes?: string;
    durationHours?: number;
    specimenLengthMillimeters?: number;
    specimenNodeCounts?: NodeCounts;
    startedAt?: Date;
    completedAt?: Date;
    reviewedAt?: Date;
    teamReviewedAt?: Date;
    approvedAt?: Date;
    publishedAt?: Date;
    archivedAt?: Date;
    specimenSomaNodeId?: string;
    annotatorId?: string;
    reviewerId?: string;
    teamReviewerId?: string;
    neuronId?: string;
}

export class Reconstruction extends BaseModel {
    public sourceUrl: string;
    public sourceComments: string;
    public status: ReconstructionStatus;
    public notes: string;
    public durationHours: number;
    public specimenLengthMillimeters: number;
    public specimenNodeCounts: NodeCounts;
    public startedAt: Date;
    public completedAt: Date;
    public reviewedAt: Date;    // Peer review timestamp (specimen-space data)
    public teamReviewedAt: Date;    // Team review timestamp
    public approvedAt: Date;    // Publish review timestamp (atlas-space data)
    public publishedAt: Date;
    public archivedAt: Date;
    public specimenSomaNodeId: string;
    public annotatorId: string;
    public reviewerId: string;
    public teamReviewerId: string;
    public neuronId: string;

    public getNodes!: HasManyGetAssociationsMixin<SpecimenNode>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getSoma!: BelongsToGetAssociationMixin<SpecimenNode>;
    public getAnnotator!: BelongsToGetAssociationMixin<User>;
    public getReviewer!: BelongsToGetAssociationMixin<User>;
    public getTeamReviewer!: BelongsToGetAssociationMixin<User>;
    public getAtlasReconstruction!: HasOneGetAssociationMixin<AtlasReconstruction>;
    public getPrecomputed!: HasOneGetAssociationMixin<SpecimenSpacePrecomputed>;

    public Neuron?: Neuron;
    public Nodes?: SpecimenNode[];
    public Annotator?: User;
    public Reviewer?: User;
    public TeamReviewer?: User;
    public AtlasReconstruction?: AtlasReconstruction;

    protected static override defaultSort(): OrderItem[] {
        return [["Neuron", "Specimen", "label", "ASC"], ["Neuron", "label", "ASC"]];
    }

    private async recordEvent(kind: EventLogItemKind, details: ReconstructionShape, user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.neuronId,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, t);
    }

    private static async createWithTransaction(user: User, shape: ReconstructionShape, t: Transaction, substituteUser: User): Promise<Reconstruction> {
        const reconstruction = await this.create(shape, {transaction: t});

        await reconstruction.recordEvent(EventLogItemKind.ReconstructionCreate, shape, user, t, substituteUser);

        return reconstruction;
    }

    public static async createForShape(user: User, shape: ReconstructionShape, t: Transaction = null, substituteUser: User = null): Promise<Reconstruction> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, shape, t, substituteUser);
            })
        } else {
            return await this.createWithTransaction(user, shape, t, substituteUser);
        }
    }

    private async updateWithTransaction(user: User, update: ReconstructionShape, t: Transaction, substituteUser: User = null) {
        const r = await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.ReconstructionUpdate, update, user, t, substituteUser);

        return r;
    }

    public static async getAll(user: User, args: ReconstructionsQueryArgs, include: Includeable[] = [], disregardAuth: boolean = false): Promise<ReconstructionQueryResponse> {
        if (!disregardAuth && !user?.canViewData()) {
            throw new UnauthorizedError();
        }

        let out: ReconstructionQueryResponse = {
            offset: 0,
            total: 0,
            reconstructions: []
        };

        const specimenInclude = [{model: Neuron, as: "Neuron", include: [{model: Specimen, as: "Specimen"}]}];

        let options: FindOptions = args.userOnly ? {where: {annotatorId: args.userId}, include: []} : {where: {}, include: []};

        // Refused rather than merged: whether the two lists would union or intersect is a guess either way, and a
        // wrong guess returns plausible-looking results instead of an error.
        if (args.status?.length > 0 && args.statusFilters?.length > 0) {
            throw new Error("A reconstruction query may filter by status or by statusFilters, but not both.");
        }

        const statusFilters: ReconstructionStatusFilter[] = args.statusFilters?.length > 0 ? args.statusFilters : (args.status ?? []).map(status => ({status}));

        if (statusFilters.length > 0) {
            const atlasReplacements = {};

            options.where[Op.or] = statusFilters.map((filter, idx) => {
                // Guarded on length because ARRAY[] with an empty replacement is a Postgres type error.
                if (!(filter.atlasStatus?.length > 0)) {
                    return {status: filter.status};
                }

                const replacementName = `reconstructionAtlasStatus${idx}`;

                atlasReplacements[replacementName] = filter.atlasStatus;

                // Correlated rather than joined, for the same reason the keyword predicate below is.  The deletedAt
                // test is explicit because a raw literal bypasses the paranoid scope.
                return {
                    [Op.and]: [{status: filter.status}, literal(`EXISTS (
            SELECT 1
            FROM "${AtlasReconstructionTableName}" AS atlas_child
            WHERE atlas_child."reconstructionId" = "${ReconstructionTableName}"."id"
              AND atlas_child."deletedAt" IS NULL
              AND atlas_child."status" = ANY(ARRAY[:${replacementName}])
          )`)]
                };
            });

            if (Object.keys(atlasReplacements).length > 0) {
                options["replacements"] = {...(options["replacements"] ?? {}), ...atlasReplacements};
            }
        }

        options["include"] = [...specimenInclude, ...include];

        if (args.specimenIds && args.specimenIds.length > 0) {
            options.where["$Neuron.Specimen.id$"] = {[Op.in]: args.specimenIds}
        }

        const keywordPatterns = substringMatchPatterns(args.keywords);

        if (keywordPatterns.length > 0) {
            // Correlated on neuronId rather than the joined "Neuron" alias, so the predicate stays valid even
            // when Sequelize moves the where clause into a paging sub-query that the join is not part of.
            options.where[Op.and] = [literal(`EXISTS (
            SELECT 1
            FROM "${NeuronTableName}" AS keyword_neuron
            WHERE keyword_neuron."id" = "${ReconstructionTableName}"."neuronId"
              AND keyword_neuron."deletedAt" IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements_text(keyword_neuron."keywords") AS elem
                  WHERE elem ILIKE ANY(ARRAY[:reconstructionKeywords])
              )
          )`)];

            options["replacements"] = {...(options["replacements"] ?? {}), reconstructionKeywords: keywordPatterns};
        }

        out.total = await this.setSortAndLimiting(options, args);
        out.offset = options.offset;

        out.reconstructions = await Reconstruction.findAll(options);

        return out;
    }

    public static async getAllPublished(user: User, offset: number = 0, limit: number = null): Promise<PublishedReconstructionQueryResponse> {
        const include = [{model: AtlasReconstruction, include: [{model: Precomputed}]}];

        const response = await Reconstruction.getAll(user, {offset: offset, limit: limit, status: [ReconstructionStatus.Published]}, include, true);

        return {
            total: response.total,
            offset: response.offset,
            reconstructions: response.reconstructions.map(r => r.AtlasReconstruction)
        }
    }

    public static async findOrOpenReconstruction(neuronId: string, user: User, substituteUser: User = null, includeUntraceable: boolean = false): Promise<Reconstruction> {
        if (!user?.canViewData()) {
            throw new UnauthorizedError();
        }

        // An annotator can hold more than one live row on a neuron: opening a reconstruction after an earlier one
        // reached Published or Archived creates a second, and neither is soft-deleted.  The import owns the annotator's
        // current attempt, so prefer their newest open row and fall back to their newest row of any status.  Falling
        // back rather than creating is what keeps a repeat import from adding a row every run when the only row is
        // already closed.
        const where = {annotatorId: user.id, neuronId: neuronId};
        const order: OrderItem[] = [["createdAt", "DESC"]];

        // The third query is for the import tools, which pass includeUntraceable: marking untraceable soft-deletes the
        // row, so neither query above can see it and a re-run would otherwise create and mark a fresh row every time.
        // It stays opt-in so a caller that has no reason to resurrect a deleted row can not do so by accident, and it
        // is scoped to Untraceable rather than dropping paranoid wholesale so a discarded row still yields a new
        // reconstruction as it does today.
        const existing = await Reconstruction.findOne({where: {...where, status: {[Op.notIn]: ClosedReconstructionStatuses}}, order})
            ?? await Reconstruction.findOne({where, order})
            ?? (includeUntraceable
                ? await Reconstruction.findOne({where: {...where, status: ReconstructionStatus.Untraceable}, order, paranoid: false})
                : null);

        if (existing) {
            return existing;
        }

        const [reconstruction, _] = await this.openReconstruction(neuronId, user, null, substituteUser, false);

        return reconstruction;
    }

    public static async updateMetadata(userOrId: User | string, args: ReconstructionMetadataArgs): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(args.reconstructionId, userOrId);

        if (!user?.canModifyReconstruction()) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const update = {};

            if (args.duration !== undefined) {
                update["durationHours"] = args.duration;
            }

            if (args.notes !== undefined) {
                update["notes"] = args.notes ?? "";
            }

            if (args.started !== undefined) {
                update["startedAt"] = args.started;
            }

            if (args.completed !== undefined) {
                update["completedAt"] = args.completed;
            }

            if (Object.keys(update).length == 0) {
                return;
            }

            return await reconstruction.updateWithTransaction(user, update, t);
        });
    }

    public static async openReconstructionRevision(userOrId: User | string, reconstructionId: string, revisionKind: ReconstructionRevisionKind): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        if (!user?.canReviseReconstruction()) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            debug(`creating revision for ${reconstruction.id}`);

            const [revision, isExisting] = await this.openReconstruction(reconstruction.neuronId, user, t);

            if (isExisting) {
                return null;
            }

            if (revisionKind == ReconstructionRevisionKind.AtlasSpace) {
                debug(`applying specimen-space data from ${reconstruction.id} to ${revision.id}`);
                await revision.copyFrom(reconstruction, user, t);
            }

            return revision;
        });
    }

    public async onAtlasReconstructionStatusChanged(user: User, status: AtlasReconstructionStatus, t: Transaction) {
        if (status == AtlasReconstructionStatus.ReadyToPublish) {
            if (this.status == ReconstructionStatus.WaitingForAtlasReconstruction) {
                const update = {status: ReconstructionStatus.ReadyToPublish};
                await this.update(update, {transaction: t});
                await this.recordEvent(EventLogItemKind.ReconstructionFinalizeApprove, update, user, t);
            } else {
                // TODO SystemError
                debug(`received unexpected atlas reconstruction status update: ${status} (current status: ${this.status})`);
            }
        } else if (status == AtlasReconstructionStatus.Published) {
            if (this.status == ReconstructionStatus.Publishing) {
                const update = {status: ReconstructionStatus.Published, publishedAt: this.publishedAt ?? new Date()};
                await this.update(update, {transaction: t});
                await this.recordEvent(EventLogItemKind.ReconstructionPublished, update, user, t);
            } else {
                // TODO SystemError
                debug(`received unexpected atlas reconstruction status update: ${status} (current status: ${this.status})`);
            }
        }
    }

    // Only reachable from ReadyToPublish: a reset from a failed phase leaves the parent where it already is.  The
    // caller holds this row's lock.
    public async resetToWaiting(user: User, t: Transaction): Promise<void> {
        const update = {status: ReconstructionStatus.WaitingForAtlasReconstruction};

        await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.ReconstructionUpdate, update, user, t);
    }

    // The indexing failure's half: without this the parent would stay at Publishing, indistinguishable from one
    // indexing normally.  Written in the same transaction as the child's FailedSearchIndexing.  The caller holds this
    // row's lock.
    public async onSearchIndexFailed(user: User, t: Transaction): Promise<void> {
        if (this.status !== ReconstructionStatus.Publishing) {
            debug(`not failing a reconstruction that is not publishing (current status: ${this.status})`);
            return;
        }

        const update = {status: ReconstructionStatus.PublishFailed};

        await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.ReconstructionUpdate, update, user, t);
    }

    // The retry's half: PublishFailed is where onSearchIndexFailed left the parent, and onAtlasReconstructionStatusChanged
    // only moves a parent it finds at Publishing.  The caller holds this row's lock.
    public async resumePublishing(user: User, t: Transaction): Promise<void> {
        if (this.status !== ReconstructionStatus.PublishFailed) {
            debug(`not resuming a reconstruction that is not at PublishFailed (current status: ${this.status})`);
            return;
        }

        const update = {status: ReconstructionStatus.Publishing};

        await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.ReconstructionUpdate, update, user, t);
    }

    public static async openReconstruction(neuronId: string, userOrId: string | User, transaction: Transaction = null, substituteUser: User = null, enforceAnnotationLimit: boolean = true): Promise<[Reconstruction, boolean]> {
        const user = await User.findUserOrId(userOrId);

        if (!user?.canAnnotate()) {
            throw new UnauthorizedError();
        }

        const enforceLimit = enforceAnnotationLimit && !user.canAnnotateMultiple();

        const ownTransaction = transaction == null;

        const t = ownTransaction ? await Reconstruction.sequelize.transaction() : transaction;

        try {
            if (enforceLimit) {
                // Serializes concurrent opens for this annotator so the one-open-annotation check below can not be
                // read by two transactions at once.  Released when the transaction ends.
                await User.findByPk(user.id, {transaction: t, lock: Transaction.LOCK.UPDATE});
            }

            // A user cannot open a new reconstruction if they have one that is not in a finalized state such as published or archived.
            const whereStatus = {status: {[Op.notIn]: [ReconstructionStatus.Published, ReconstructionStatus.Archived, ReconstructionStatus.Untraceable, ReconstructionStatus.Discarded]}};

            const existingReconstruction = await Reconstruction.findOne({
                where: {
                    annotatorId: user.id,
                    neuronId: neuronId,
                    ...whereStatus,
                }, transaction: t
            });

            if (existingReconstruction) {
                if (ownTransaction) {
                    await t.commit();
                }

                return [existingReconstruction, true];
            }

            if (enforceLimit) {
                const openCount = await Reconstruction.count({
                    where: {
                        annotatorId: user.id,
                        status: {[Op.notIn]: AnnotationLimitExemptStatuses}
                    }, transaction: t
                });

                if (openCount > 0) {
                    throw new GraphQLError("You already have an annotation in progress.  Complete or discard it before starting another.", {extensions: {code: 1002}});
                }
            }

            const shape: ReconstructionShape = {
                neuronId: neuronId,
                annotatorId: user.id,
                status: ReconstructionStatus.InProgress,
                startedAt: new Date()
            };

            const reconstruction = await Reconstruction.createWithTransaction(user, shape, t, substituteUser);

            const atlasShape: AtlasReconstructionShape = {
                status: AtlasReconstructionStatus.Initialized,
                reconstructionId: reconstruction.id,
            };

            await AtlasReconstruction.createForShape(user, atlasShape, t, substituteUser);

            if (ownTransaction) {
                await t.commit();
            }

            return [reconstruction, false];
        } catch (err) {
            if (ownTransaction) {
                await t.rollback();
            }

            throw err;
        }
    }

    private static async findReconstructionAndUser(id: string, userOrId: User | string, include: FindOptions["include"] = [], allowNoUser: boolean = false): Promise<[Reconstruction, User]> {
        const reconstruction = await Reconstruction.findByPk(id, {include: include});

        if (!reconstruction) {
            throw new NotFoundError(`Reconstruction ${id} does not exist`);
        }

        const user = await User.findUserOrId(userOrId);

        if (!allowNoUser && !user) { // TODO Remove (along with method arg) once approve doesn't need an automation bypass.
            // Don't reveal too much information about users/not users.
            throw new UnauthorizedError();
        }

        return [reconstruction, user];
    }

    public static async pauseReconstruction(id: string, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        return Reconstruction.holdReconstruction(id, userOrId, {
            status: ReconstructionStatus.OnHold,
            eventKind: EventLogItemKind.ReconstructionPause,
            refusal: statusName => `Cannot pause a reconstruction with status ${statusName}.`
        }, substituteUser, disregardAuth);
    }

    public static async markIncomplete(id: string, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        return Reconstruction.holdReconstruction(id, userOrId, {
            status: ReconstructionStatus.Incomplete,
            eventKind: EventLogItemKind.ReconstructionIncomplete,
            refusal: statusName => `Cannot mark a reconstruction with status ${statusName} as incomplete.`
        }, substituteUser, disregardAuth);
    }

    public static async markDuplicate(id: string, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        return Reconstruction.holdReconstruction(id, userOrId, {
            status: ReconstructionStatus.Duplicate,
            eventKind: EventLogItemKind.ReconstructionDuplicate,
            refusal: statusName => `Cannot mark a reconstruction with status ${statusName} as a duplicate.`
        }, substituteUser, disregardAuth);
    }

    // TODO When the SmartSheet import is no longer required, remove disregardAuth and don't allow the possibility of
    //  overriding.  The import reconciles against an external source of truth and holds reconstructions on behalf of
    //  annotators who hold no portal permission; the source-status rule below applies to it exactly as it does to the
    //  portal.
    private static async holdReconstruction(id: string, userOrId: User | string, transition: HoldTransition, substituteUser: User, disregardAuth: boolean): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        if (!disregardAuth) {
            if (!user?.canPauseReconstruction(reconstruction.annotatorId)) {
                throw new UnauthorizedError();
            }
        }

        // Unconditional: disregardAuth buys the import tools out of the permission, never out of the state rule.  A
        // reconstruction already in review or in the pipeline is not the annotator's - or an import's - to suspend, and
        // one already held resumes before it is held differently.
        if (!PausableSourceStatuses.includes(reconstruction.status)) {
            throw new Error(transition.refusal(ReconstructionStatus[reconstruction.status]));
        }

        return await this.sequelize.transaction(async (transaction) => {
            const update = {status: transition.status};

            const updated = await reconstruction.update(update, {transaction: transaction});

            await updated.recordEvent(transition.eventKind, update, user, transaction, substituteUser);

            return updated;
        });
    }

    public static async resumeReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        if (!user?.canResumeReconstruction(reconstruction.annotatorId)) {
            throw new UnauthorizedError();
        }

        if (!ResumableSourceStatuses.includes(reconstruction.status)) {
            throw new Error(`Cannot resume a reconstruction with status ${ReconstructionStatus[reconstruction.status]}.`);
        }

        return await this.sequelize.transaction(async (t) => {
            const update = {status: ReconstructionStatus.InProgress};

            const r = await reconstruction.update(update, {transaction: t});

            await r.recordEvent(EventLogItemKind.ReconstructionResume, update, user, t, substituteUser);

            return r;
        });
    }

    public static async requestReview(args: ReviewRequestArgs, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        const {reconstructionId, targetStatus, duration, notes} = args;

        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        if (!ReviewRequestEventKinds.has(targetStatus)) {
            throw new Error("Requested status must be Peer Review, Team Review or Publish Review")
        }

        // Both import tools call this to park a reconstruction at PublishReview before uploading and approving, and a
        // run whose approve was refused for want of atlas data leaves the row there for the next run to finish.  A
        // parking step that finds the reconstruction already where it is asking for is satisfied, not refused: nothing
        // is written and no event is recorded.  Portal callers keep the refusal - asking for a review a reconstruction
        // is already in is a mistake there.
        if (disregardAuth && reconstruction.status == targetStatus) {
            return reconstruction;
        }

        // TODO When the SmartSheet import is no longer required, remove disregardAuth and don't allow the possibility of overriding. disregardAuth is needed
        //  because SmartSheets contain people as reviewers that we need to make as users in the system, but should not be auto-granted review permissions in
        //  the portal.
        if (!disregardAuth) {
            if (!user?.canRequestReview(reconstruction.annotatorId)) {
                throw new UnauthorizedError();
            }
        }

        // Unconditional: disregardAuth buys the import tools out of the permission, never out of the state rule.  Once
        // a reconstruction is in review or in the pipeline, moving it back to a review status is a rewind the portal
        // has no route to produce.
        if (!ReviewRequestSourceStatuses.includes(reconstruction.status)) {
            throw new Error(`Cannot request a review for a reconstruction with status ${ReconstructionStatus[reconstruction.status]}.`);
        }

        const update = {
            status: targetStatus,
            completedAt: new Date()
        }

        if (isNotNullOrUndefined(duration)) {
            update["durationHours"] = duration;
        }

        if (isNotNullOrUndefined(notes)) {
            update["notes"] = notes;
        }

        return await this.sequelize.transaction(async (t) => {
            const r = await reconstruction.update(update, {transaction: t});

            await r.recordEvent(ReviewRequestEventKinds.get(targetStatus), update, user, t, substituteUser);

            return r;
        });
    }

    public static async approveReconstruction(id: string, targetStatus: ReconstructionStatus, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId, [], true);

        // TODO When the SmartSheet import is no longer required, remove disregardAuth and don't allow the possibility of overriding. disregardAuth is needed
        //  because SmartSheets contain people as reviewers that we need to make as users in the system, but should not be auto-granted review permissions in
        //  the portal.
        // At least block for the optional review sign-offs, neither of which is a part of import.
        if (disregardAuth && (targetStatus == ReconstructionStatus.TeamReview || targetStatus == ReconstructionStatus.PublishReview)) {
            throw new UnauthorizedError();
        }

        const requiredSources = ApprovalSourceStatuses.get(targetStatus);

        if (requiredSources === undefined) {
            throw new Error("Requested approval status is not supported");
        }

        if (!disregardAuth) {
            if (!user?.canApproveReconstruction(targetStatus, reconstruction.status)) {
                throw new UnauthorizedError();
            }

            if (!requiredSources.includes(reconstruction.status)) {
                throw new Error(`Cannot approve a reconstruction with status ${ReconstructionStatus[reconstruction.status]} to ${ReconstructionStatus[targetStatus]}.`);
            }
        }

        return await this.sequelize.transaction(async (t) => {
            // Child first, then parent.  Reject, discard and the uploads take the same two rows in this order, and
            // approval taking them the other way round is a deadlock between two ordinary publish-reviewer actions on
            // one reconstruction.  Neither review sign-off touches the child, so both lock the parent alone and cannot
            // be part of a cycle either way.
            const atlasReconstruction = targetStatus == ReconstructionStatus.Approved
                ? await AtlasReconstruction.findOne({
                    where: {reconstructionId: reconstruction.id},
                    lock: Transaction.LOCK.UPDATE,
                    transaction: t
                })
                : null;

            const locked = await Reconstruction.findByPk(reconstruction.id, {transaction: t, lock: Transaction.LOCK.UPDATE});

            // Repeated against the locked row, and unconditionally: a reject or another approval can have moved the
            // parent since the check above, and an import approving over a rejection that committed in between would
            // silently reverse it.  disregardAuth buys the import out of the permission, never out of the state rule -
            // both imports call requestReview(PublishReview) immediately before this, so both satisfy it.
            //
            // The permission is repeated too, because which actor may approve now depends on the source: a peer
            // reviewer who passed the check above at PeerReview must not approve a reconstruction a request has since
            // moved to TeamReview.  Admissibility first, so a row that moved reports the clearer error.
            if (!requiredSources.includes(locked.status)) {
                throw new Error(`Cannot approve a reconstruction with status ${ReconstructionStatus[locked.status]} to ${ReconstructionStatus[targetStatus]}.`);
            }

            if (!disregardAuth && !user.canApproveReconstruction(targetStatus, locked.status)) {
                throw new UnauthorizedError();
            }

            if (targetStatus != ReconstructionStatus.Approved) {
                // A review sign-off: peer review to team or publish review, or team review to publish review.  Which
                // reviewer is recorded follows the stage being left, not the one being entered.
                const update = locked.status == ReconstructionStatus.TeamReview
                    ? {status: targetStatus, teamReviewerId: user.id, teamReviewedAt: new Date()}
                    : {status: targetStatus, reviewerId: user.id, reviewedAt: new Date()};

                const kind = locked.status == ReconstructionStatus.TeamReview
                    ? EventLogItemKind.ReconstructionApproveTeamReview
                    : EventLogItemKind.ReconstructionApprovePeerReview;

                const r = await locked.update(update, {transaction: t});

                await r.recordEvent(kind, update, user, t, substituteUser);

                return r;
            }

            // Applies to every caller including the imports, which depend on this refusal: both catch it and record the
            // reconstruction as failed to approve.
            if (!atlasReconstruction?.nodeCounts) {
                throw new GraphQLError("The atlas reconstruction data must be uploaded before the reconstruction is approved.", {extensions: {code: 1005}});
            }

            // Publish review is being approved.
            const update = {status: ReconstructionStatus.Approved, approvedAt: new Date()};

            const r = await locked.update(update, {transaction: t});

            await r.recordEvent(EventLogItemKind.ReconstructionApprovePublishReview, update, user, t, substituteUser);

            await atlasReconstruction.approve(user, t, substituteUser);

            return await locked.update({status: ReconstructionStatus.WaitingForAtlasReconstruction}, {transaction: t});
        });
    }

    private static isRejectable(status: ReconstructionStatus, childStatus: AtlasReconstructionStatus): boolean {
        return RejectableSourceStatuses.includes(status)
            || (status == ReconstructionStatus.WaitingForAtlasReconstruction && AbandonableFailureStatuses.includes(childStatus))
            // A clause of its own rather than a new member of AbandonableFailureStatuses: that set is shared with
            // isDiscardable and the pipeline replay, and widening it would hand both of them a route out of
            // PublishFailed.  Reject is the only one, and it releases the neuron rather than recovering the publication.
            || (status == ReconstructionStatus.PublishFailed && childStatus == AtlasReconstructionStatus.FailedSearchIndexing);
    }

    private static isDiscardable(status: ReconstructionStatus, childStatus: AtlasReconstructionStatus): boolean {
        return DiscardableSourceStatuses.includes(status)
            || AdminDiscardableSourceStatuses.includes(status)
            || status == ReconstructionStatus.ReadyToPublish
            || (status == ReconstructionStatus.WaitingForAtlasReconstruction && AbandonableFailureStatuses.includes(childStatus));
    }

    public static async rejectReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId, [{model: AtlasReconstruction}]);

        // Early refusal only, so an unauthorized caller is turned away without opening a transaction.
        if (!user?.canRejectReconstruction(reconstruction.status, reconstruction.AtlasReconstruction?.status ?? null)) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const atlasReconstruction = await AtlasReconstruction.findOne({
                where: {reconstructionId: reconstruction.id},
                lock: Transaction.LOCK.UPDATE,
                transaction: t
            });

            const locked = await Reconstruction.findByPk(reconstruction.id, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const sourceStatus = locked.status;
            const childStatus = atlasReconstruction?.status ?? null;

            // The permission is repeated, not just the admissibility test: which actor may reject depends on the
            // status, so a parent that moved between the eager read and this lock can change who is allowed as well as
            // whether anyone is.  A peer reviewer who passed the check above at PeerReview must not reject a
            // reconstruction an approval has since moved to PublishReview.
            if (!user.canRejectReconstruction(sourceStatus, childStatus)) {
                throw new UnauthorizedError();
            }

            if (!Reconstruction.isRejectable(sourceStatus, childStatus)) {
                throw new Error(`Cannot reject a reconstruction with status ${ReconstructionStatus[sourceStatus]}.`);
            }

            const update = {
                status: ReconstructionStatus.Rejected
            };

            if (sourceStatus == ReconstructionStatus.PeerReview) {
                update["reviewerId"] = user.id;
            } else if (sourceStatus == ReconstructionStatus.TeamReview) {
                update["teamReviewerId"] = user.id;
            }

            const r = await locked.update(update, {transaction: t});

            await r.recordEvent(EventLogItemKind.ReconstructionReject, update, user, t, substituteUser);

            // Neither optional review touches the child.  AtlasReconstruction.reject unconditionally writes reviewerId,
            // and that field is the publish reviewer the DOI credits - neither a peer nor a team reviewer may overwrite
            // it.  Nothing is lost by skipping it: at either review the child is Initialized or ReadyToProcess, never a
            // failed phase, so there is no failure state to rewind.
            if (sourceStatus != ReconstructionStatus.PeerReview && sourceStatus != ReconstructionStatus.TeamReview) {
                await atlasReconstruction.reject(user, t);
            }

            return r;
        });
    }

    public static async publish(userOrId: User, reconstructionId: string, replaceExisting: boolean = false): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId, [{model: AtlasReconstruction}, {model: Neuron, as: "Neuron"}]);

        if (!user?.canPublish()) {
            throw new UnauthorizedError();
        }

        if (!reconstruction) {
            throw new Error("The reconstruction could not be found");
        }

        if (reconstruction.AtlasReconstruction.nodeCounts == null || reconstruction.status != ReconstructionStatus.ReadyToPublish) {
            throw new Error("The reconstruction is not in a publishable state");
        }

        // Asserted, not assigned: the DOI assignment phase registers both DOIs before the child reaches
        // ReadyToPublish, so publish makes no DataCite call at all.
        if (!reconstruction.AtlasReconstruction.doi || !reconstruction.Neuron?.canonicalDoi) {
            throw new Error("The reconstruction has no DOI assigned");
        }

        return await this.sequelize.transaction(async (t) => {
            return await reconstruction.publishWithTransaction(user, replaceExisting, t);
        });
    }

    private async publishWithTransaction(user: User, replaceExisting: boolean, t: Transaction): Promise<Reconstruction> {
        // Guard here (not just in publish) so bulk publishing can not push a reconstruction that is not ready into the publish path.
        if (this.AtlasReconstruction?.nodeCounts == null || this.status != ReconstructionStatus.ReadyToPublish) {
            throw new PublishRefusalError("The reconstruction is not in a publishable state", 1008);
        }

        // Serializes concurrent publishes of the same neuron: without it two transactions each read no sibling and both
        // proceed.  Follows openReconstruction's lock on the annotator and is released when the transaction ends.
        const neuron = await Neuron.findByPk(this.neuronId, {transaction: t, lock: Transaction.LOCK.UPDATE});

        // Both instances were loaded before this transaction opened.  Reset, reject, discard and the uploads can all
        // have moved the pair since, and every one of them takes this same child lock, so re-reading here is what
        // serializes against them.  findByPk rather than reload for the parent - reload re-applies the eager include
        // and Postgres refuses FOR UPDATE on the nullable side of an outer join.
        const atlasReconstruction = await AtlasReconstruction.findOne({
            where: {reconstructionId: this.id},
            lock: Transaction.LOCK.UPDATE,
            transaction: t
        });

        const locked = await Reconstruction.findByPk(this.id, {transaction: t, lock: Transaction.LOCK.UPDATE});

        if (!atlasReconstruction?.nodeCounts || locked.status != ReconstructionStatus.ReadyToPublish) {
            throw new PublishRefusalError("The reconstruction is not in a publishable state", 1008);
        }

        // Asserted, not assigned: the DOI assignment phase registers both DOIs before the child reaches
        // ReadyToPublish, so publish makes no DataCite call.  Read off the locked rows because Neuron is not
        // eager-loaded on every path in - publishAll enters through this method directly.
        //
        // Deliberately not a PublishRefusalError.  The DOIs are registered before this status and a pipeline reset
        // keeps them, so a ReadyToPublish row without one is a broken row rather than a lost race, and publishAll
        // should surface it instead of stopping quietly and handing back a short list that reads as contention.
        if (!atlasReconstruction.doi || !neuron?.canonicalDoi) {
            throw new Error("The reconstruction has no DOI assigned");
        }

        const siblings = await Reconstruction.findAll({
            where: {neuronId: this.neuronId, status: {[Op.in]: PublishedCandidateBlockingStatuses}},
            transaction: t
        });

        // Checked first because a neuron can hold both a Published sibling and one mid-publish, and the refusal wins.
        // A reconstruction already in transition to published is not something a second publish may displace, and
        // replaceExisting does not apply to it.  PublishFailed is the same case stalled: its predecessor is already
        // archived and de-indexed, and requestSearchIndexing is what finishes it.
        if (siblings.some(sibling => sibling.status == ReconstructionStatus.Publishing || sibling.status == ReconstructionStatus.PublishFailed)) {
            throw new PublishRefusalError("A publish is already in progress for this neuron, or has stalled and is awaiting a retry.", 1003);
        }

        const existingPublished = siblings.find(sibling => sibling.status == ReconstructionStatus.Published);

        if (existingPublished) {
            if (!replaceExisting) {
                throw new PublishRefusalError("This neuron has an existing published reconstruction.", 1001);
            }

            await existingPublished.archivePublished(user, t);
        }

        if (!(await atlasReconstruction.tryStartPublishing(user, t))) {
            throw new PublishRefusalError("The associated atlas reconstruction is not in a publishable state", 1008);
        }

        const update = {status: ReconstructionStatus.Publishing};

        const updated = await locked.update(update, {transaction: t});

        await updated.recordEvent(EventLogItemKind.ReconstructionPublishing, update, user, t);

        return updated;
    }

    public static async publishAll(user: User, reconstructionIds: string[]): Promise<Reconstruction[]> {
        if (!user?.canPublish()) {
            throw new UnauthorizedError();
        }

        if (reconstructionIds.length > PublishAllLimit) {
            throw new GraphQLError(`At most ${PublishAllLimit} reconstructions can be published in one request.`, {extensions: {code: 1007}});
        }

        let reconstructions: Reconstruction[];

        if (reconstructionIds.length == 1 && reconstructionIds[0] == "ALL") {
            // Oldest first so repeated calls walk the queue in a stable order rather than reshuffling the selection.
            // The id tie-break is required, not decorative: createdAt is written from JavaScript at millisecond
            // resolution, so rows created in one loop or one import tie, and Postgres leaves tied rows unordered - a
            // tied row could otherwise move into and out of the batch between calls.  The primary key is a UUIDv7, so
            // ordering by it second is itself creation-ordered and agrees with the first key.
            //
            // The sibling filter is what makes repeated calls drain: a reconstruction whose neuron already holds a
            // publish is refused by publishWithTransaction on every attempt, and without this it keeps its place at the
            // head of the oldest-first batch forever.  The same constant the refusal queries its siblings with, so the
            // two cannot drift.  Correlated rather than joined, and the deletedAt test is explicit because a raw
            // literal bypasses the paranoid scope - the statusFilters atlas predicate in getAll carries both for the
            // same reasons.  It narrows the selection and is not a guard: a sibling committing between this query and
            // the transaction is still refused there.
            const options: FindOptions = {
                where: {
                    status: ReconstructionStatus.ReadyToPublish,
                    [Op.and]: [literal(`NOT EXISTS (
            SELECT 1
            FROM "${ReconstructionTableName}" AS sibling
            WHERE sibling."neuronId" = "${ReconstructionTableName}"."neuronId"
              AND sibling."id" != "${ReconstructionTableName}"."id"
              AND sibling."deletedAt" IS NULL
              AND sibling."status" = ANY(ARRAY[:publishBlockingStatuses])
          )`)]
                },
                include: [{model: AtlasReconstruction}],
                order: [["createdAt", "ASC"], ["id", "ASC"]],
                limit: PublishAllLimit
            };

            options["replacements"] = {publishBlockingStatuses: PublishedCandidateBlockingStatuses};

            reconstructions = await this.findAll(options);
        } else {
            reconstructions = await this.findAll({where: {id: {[Op.in]: reconstructionIds}}, include: [{model: AtlasReconstruction}]});
        }

        const updated: Reconstruction[] = [];

        // Publish each reconstruction in its own transaction so one failure does not roll back the others.
        //
        // A refusal ends the run and the reconstructions that did publish are returned: that is the normal outcome of a
        // sibling committing between the selection and the transaction, and the caller either calls again or diffs the
        // list against what it sent.  Anything else - a lock timeout, a failed commit, a defect - is not a refusal and
        // propagates, because reporting an outage as a short list invites the caller to retry into it forever.  What
        // committed before it stays committed either way.
        for (const reconstruction of reconstructions) {
            try {
                updated.push(await this.sequelize.transaction(async (t) => {
                    return await reconstruction.publishWithTransaction(user, false, t);
                }));
            } catch (error) {
                if (!(error instanceof PublishRefusalError)) {
                    throw error;
                }

                debug(`publishAll stopped at ${reconstruction.id}: ${error.message}`);

                break;
            }
        }

        return updated;
    }

    public static async discardReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId, [{model: AtlasReconstruction}]);

        const eagerChildStatus = reconstruction.AtlasReconstruction?.status ?? null;

        // Status first, so an admin refused for a status reason gets the descriptive error rather than Unauthorized.
        if (!Reconstruction.isDiscardable(reconstruction.status, eagerChildStatus)) {
            throw new Error(`Cannot discard a reconstruction with status ${ReconstructionStatus[reconstruction.status]}.`);
        }

        if (!user?.canDiscardReconstruction(reconstruction.annotatorId, reconstruction.status, eagerChildStatus)) {
            throw new UnauthorizedError();
        }

        return await Reconstruction.sequelize.transaction(async (t) => {
            const atlasReconstruction = await AtlasReconstruction.findOne({
                where: {reconstructionId: reconstruction.id},
                lock: Transaction.LOCK.UPDATE,
                transaction: t
            });

            const locked = await Reconstruction.findByPk(reconstruction.id, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const childStatus = atlasReconstruction?.status ?? null;

            // Re-decided and re-authorized under the locks: a retry can have restarted a failed phase, and a
            // requestReview can have moved the parent to a status only an admin may discard from.
            if (!Reconstruction.isDiscardable(locked.status, childStatus)) {
                throw new Error(`Cannot discard a reconstruction with status ${ReconstructionStatus[locked.status]}.`);
            }

            if (!user.canDiscardReconstruction(locked.annotatorId, locked.status, childStatus)) {
                throw new UnauthorizedError();
            }

            await AtlasReconstruction.discardForReconstruction(user, reconstruction.id, t);

            await SpecimenNode.destroy({
                where: {
                    reconstructionId: reconstruction.id
                }, transaction: t
            });

            const update = {status: ReconstructionStatus.Discarded};

            await locked.update(update, {transaction: t});

            await locked.destroy({transaction: t});

            await locked.recordEvent(EventLogItemKind.ReconstructionDiscard, update, user, t, substituteUser);

            return locked;
        });
    }

    public static async markUntraceable(id: string, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        // disregardAuth is for the import tools, which reconcile against an external source of truth and mark
        // reconstructions untraceable on behalf of annotators who hold no portal permission.
        if (!disregardAuth) {
            if (!user?.canMarkReconstructionUntraceable(reconstruction.annotatorId)) {
                throw new UnauthorizedError();
            }
        }

        // Unconditional: disregardAuth buys the import tools out of the permission, never out of the state rule.  This
        // is the transition that costs most if it fires at the wrong status - the teardown below destroys the quality
        // control row, the atlas nodes, the child and the specimen nodes, and neither node table is paranoid.
        if (!UntraceableSourceStatuses.includes(reconstruction.status)) {
            throw new Error(`Cannot mark a reconstruction with status ${ReconstructionStatus[reconstruction.status]} as untraceable.`);
        }

        // Torn down exactly as a discard is: the row and everything downstream of it soft-delete, so the attempt drops
        // out of every ordinary query.  Neuron.untraceable is the sole reader that needs it back and overrides paranoid
        // to find it.
        return await Reconstruction.sequelize.transaction(async (t) => {
            await AtlasReconstruction.discardForReconstruction(user, reconstruction.id, t);

            await SpecimenNode.destroy({
                where: {
                    reconstructionId: reconstruction.id
                }, transaction: t
            });

            const update = {status: ReconstructionStatus.Untraceable};

            await reconstruction.update(update, {transaction: t});

            await reconstruction.destroy({transaction: t});

            await reconstruction.recordEvent(EventLogItemKind.ReconstructionUntraceable, update, user, t, substituteUser);

            return reconstruction;
        });
    }

    private static async validateUploadArgs(args: ReconstructionUploadArgs): Promise<UploadError | null> {
        if (!args.file) {
            return new UploadError("The JSON or SWC file is missing.");
        }

        return null;
    }

    public static async fromSwcUpload(userOrId: User | string, args: ReconstructionUploadArgs): Promise<Reconstruction> {
        await Reconstruction.validateUploadArgs(args);

        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(args.reconstructionId, userOrId);

        if (!user.canUploadReconstructionData(args.reconstructionSpace, reconstruction.status)) {
            throw new UnauthorizedError();
        }

        const file: any = await args.file;

        const reconstructionData = await parseSwcFile(file.filename, file.createReadStream());

        await reconstruction.fromParsedStructures(user, args.reconstructionSpace, reconstructionData);

        return await Reconstruction.findByPk(args.reconstructionId);
    }

    public static async fromSwcFile(userOrId: User | string, reconstructionId: string, sourceFile: string, space: ReconstructionSpace, substituteUser: User): Promise<void> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        const reconstructionData = await parseSwcFile(sourceFile, fs.createReadStream(sourceFile));

        // The import's uploader is an imported proofreader who by design holds no portal review permissions; the status
        // check inside still applies to it.
        await reconstruction.fromParsedStructures(user, space, reconstructionData, substituteUser, true);
    }

    public static async fromParquetUpload(userOrId: User | string, args: ReconstructionUploadArgs): Promise<Reconstruction> {
        if (!args.file) {
            throw new UploadError("The Parquet file is missing.");
        }

        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(args.reconstructionId, userOrId);

        if (!user.canUploadReconstructionData(args.reconstructionSpace, reconstruction.status)) {
            throw new UnauthorizedError();
        }

        const file: any = await args.file;

        const reconstructionData = await parseParquetUpload(file.filename, file.createReadStream());

        await reconstruction.fromParsedStructures(user, args.reconstructionSpace, reconstructionData);

        return await Reconstruction.findByPk(args.reconstructionId);
    }

    public static async fromParquetFile(userOrId: User | string, reconstructionId: string, sourceFile: string, space: ReconstructionSpace, substituteUser: User): Promise<void> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        const reconstructionData = await parseParquetFile(sourceFile, sourceFile);

        // See fromSwcFile: the import's uploader holds no portal review permissions.
        await reconstruction.fromParsedStructures(user, space, reconstructionData, substituteUser, true);
    }

    public static async toPortalFormat(user: User, idOrAtlasId: string): Promise<PortalReconstruction> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const includes: any[] = [{
            model: User,
            as: "Annotator"
        }, {
            model: User,
            as: "Reviewer"
        }, {
            model: User,
            as: "TeamReviewer"
        }, {
            model: Neuron,
            as: "Neuron",
            include: [{
                model: Specimen,
                as: "Specimen",
                include: [{
                    model: Injection,
                    include: [{
                        model: InjectionVirus,
                    }, {
                        model: Fluorophore,
                    }]
                }, {
                    model: Genotype,
                }, {
                    model: Collection,
                }]
            }]
        }];

        // Assume it is direct reference.
        let reconstruction = await this.findByPk(idOrAtlasId, {
            include: includes.length > 0 ? includes : undefined
        });

        if (!reconstruction) {
            // Some context, such as the current Export service, only have access to the associated Atlas reconstruction id.  Allow it to be a fallback.
            const atlas = await AtlasReconstruction.findByPk(idOrAtlasId);

            if (!atlas) {
                return null;
            }

            debug(`toPortalFormat found atlas reconstruction ${idOrAtlasId}`);

            reconstruction = await this.findByPk(atlas.reconstructionId, {
                include: includes.length > 0 ? includes : undefined
            });
        } else {
            debug(`toPortalFormat found reconstruction ${idOrAtlasId}`);
        }

        if (!reconstruction) {
            debug(`toPortalFormat ${idOrAtlasId} not found as specimen or atlas reconstruction`);
            return null;
        }

        const nodes = await this.serializeNodes(user, reconstruction.id);

        return {
            id: reconstruction.id,
            annotationSpace: PortalAnnotationSpace.Specimen,
            doi: null,
            neuron: reconstruction.Neuron.toPortalFormat(),
            annotator: reconstruction.Annotator?.toPortalFormat() ?? null,
            peerReviewer: reconstruction.Reviewer?.toPortalFormat() ?? null,
            teamReviewer: reconstruction.TeamReviewer?.toPortalFormat() ?? null,
            proofreader: null,
            nodes: nodes
        }
    }

    public static async serializeNodes(user: User, reconstructionId: string): Promise<PortalNode[]> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const options: FindOptions = {
            where: {reconstructionId: reconstructionId},
            include: [{
                model: NodeStructure,
            }],
            order: [["index", "ASC"]]
        };

        const nodes = await SpecimenNode.findAll(options);

        return nodes.map(n => {
            return {
                index: n.index,
                structure: NeuronStructure.swcStructureValue(n.neuronStructureId),
                x: n.x,
                y: n.y,
                z: n.z,
                radius: n.radius,
                parentIndex: n.parentIndex,
            }
        });
    }

    private async archivePublished(user: User, t: Transaction): Promise<void> {
        const shape = {
            status: ReconstructionStatus.Archived,
            archivedAt: new Date(),
        };

        await this.update(shape, {transaction: t});


        const atlasReconstruction = await this.getAtlasReconstruction({transaction: t});

        if (atlasReconstruction) {
            await SearchIndex.destroy({
                where: {reconstructionId: atlasReconstruction.id},
                transaction: t
            });
        }

        await this.recordEvent(EventLogItemKind.ReconstructionArchive, shape, user, t);
    }

    /*
     * Copies the specimen-space properties from the source reconstruction to this reconstruction instance.  This is primarily for creating revisions to
     * neuron reconstructions that will only change the atlas-space reconstruction information and saves the user the step of re-uploading or applying
     * specimen-space metadata and reconstruction data.
     */
    private async copyFrom(source: Reconstruction, user: User, t: Transaction): Promise<void> {
        const nodes = await SpecimenNode.findAll({
            where: {
                reconstructionId: source.id
            },
            transaction: t
        });

        const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

        for (let idx = 0; idx < nodes.length; idx += chunkSize) {
            const nodeData = nodes.slice(idx, idx + chunkSize).map(n => {
                const obj = n.toJSON();
                obj.id = undefined;
                obj.reconstructionId = this.id;
                return obj;
            });

            await SpecimenNode.bulkCreate(nodeData, {transaction: t});
        }

        const soma = await SpecimenNode.findOne({
            where: {
                reconstructionId: this.id,
                index: 1
            },
            transaction: t
        });

        const shape = {
            status: ReconstructionStatus.InProgress,
            sourceUrl: source.sourceUrl,
            sourceComments: source.sourceComments,
            notes: source.notes,
            durationHours: source.durationHours,
            specimenLengthMillimeters: source.specimenLengthMillimeters,
            specimenNodeCounts: source.specimenNodeCounts,
            specimenSomaNodeId: soma?.id
        };

        await this.update(shape, {transaction: t});

        const precomputed = await SpecimenSpacePrecomputed.createForReconstruction(user, this.id, t);

        await precomputed.requestGeneration(user, t);
    }

    private async fromParsedStructures(user: User, space: ReconstructionSpace, reconstructionData: SimpleReconstruction, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        // TODO allow for soma in axon or dendrite.  replaceNodes in both reconstruction types would need to be updated.
        const soma = reconstructionData.axon.soma ?? reconstructionData.dendrite.soma;


        if (!soma) {
            throw new UploadError("A soma was not found in the uploaded file.");
        }

        // TODO also check soma x, y, z are the same within some tolerance.

        return await this.sequelize.transaction(async (t) => {
            if (space == ReconstructionSpace.Specimen) {
                // Parent only: this branch does not touch the child or the neuron, so it cannot be part of a lock cycle.
                const locked = await Reconstruction.findByPk(this.id, {transaction: t, lock: Transaction.LOCK.UPDATE});

                // Re-checked under the lock.  The caller's check ran before the file was parsed, which is the slow
                // part - an approval can easily have committed in between, and both the status and who is allowed to
                // write at that status change with it.
                if (!UploadSourceStatuses.get(space)?.has(locked.status)) {
                    throw new Error("The reconstruction data can not be modified when not in peer, team or publish review");
                }

                if (!disregardAuth && !user.canUploadReconstructionData(space, locked.status)) {
                    throw new UnauthorizedError();
                }

                const updated = await locked.replaceNodeData(user, reconstructionData, t);

                let precomputed = await SpecimenSpacePrecomputed.findOne({where: {reconstructionId: this.id}, transaction: t});

                if (!precomputed) {
                    precomputed = await SpecimenSpacePrecomputed.createForReconstruction(user, this.id, t);
                }

                await precomputed.requestGeneration(user, t);

                return updated;
            }

            // Neuron, then child, then parent - publish's order.  The atlas-soma back-fill below updates this row, so
            // this transaction takes its write lock either way; taking it last is the inversion that deadlocks against
            // a publish holding the neuron and waiting on the child.  neuronId is immutable, so the eager instance is a
            // safe source for it.
            const neuron = await Neuron.findByPk(this.neuronId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const atlasReconstruction = await AtlasReconstruction.findOne({
                where: {reconstructionId: this.id},
                lock: Transaction.LOCK.UPDATE,
                transaction: t
            });

            if (!atlasReconstruction) {
                throw new UploadError(`Atlas reconstruction for ${this.id} not found.`)
            }

            const locked = await Reconstruction.findByPk(this.id, {transaction: t, lock: Transaction.LOCK.UPDATE});

            // Approved is gone as a source: the approval now requires the data, so an upload arriving after one has
            // committed is a lost race, not a deferred step, and replaceNodeData would otherwise rewind the child out
            // of the pipeline and strand the parent at WaitingForAtlasReconstruction.
            if (!UploadSourceStatuses.get(space)?.has(locked.status)) {
                throw new Error("The reconstruction data can not be modified when not in team or publish review");
            }

            if (!disregardAuth && !user.canUploadReconstructionData(space, locked.status)) {
                throw new UnauthorizedError();
            }

            await atlasReconstruction.replaceNodeData(user, reconstructionData, t);

            // getSoma reads the association replaceNodeData has just repointed, so the back-fill stays after it; the
            // neuron it writes is the row locked at the top rather than a fresh getNeuron read.
            if (neuron.atlasSoma.x < 0.01 || neuron.atlasSoma.y < 0.01 || neuron.atlasSoma.z < 0.01) {
                const atlasSoma = await atlasReconstruction.getSoma({transaction: t});

                await neuron.update({atlasSoma: {x: atlasSoma.x, y: atlasSoma.y, z: atlasSoma.z}}, {transaction: t});
            }
        });
    }

    private async replaceNodeData(user: User, reconstructionData: SimpleReconstruction, t: Transaction): Promise<Reconstruction> {
        try {
            await this.update({specimenSomaNodeId: null}, {transaction: t});

            await SpecimenNode.destroy({
                where: {reconstructionId: this.id},
                transaction: t
            });

            for (const s of [reconstructionData.axon, reconstructionData.dendrite]) {
                const nodeData: SpecimenNodeShape[] = s.getNonSomaNodes().map(node => mapToSpecimenNodeShape(node, s.NeuronStructureId, this.id));

                const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

                for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                    await SpecimenNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction: t});
                }
            }

            const somaShape = mapToSpecimenNodeShape(reconstructionData.axon.soma, NeuronStructure.SomaNeuronStructureId, this.id);

            const soma = await SpecimenNode.create(somaShape, {transaction: t});

            const updated = await this.update({
                sourceUrl: reconstructionData.source,
                sourceComments: reconstructionData.comments,
                specimenNodeCounts: {axon: reconstructionData.axon.nodeCounts, dendrite: reconstructionData.dendrite.nodeCounts},
                specimenSomaNodeId: soma?.id
            }, {transaction: t});

            await this.recordEvent(EventLogItemKind.ReconstructionUpload, null, user, t);

            return updated;
        } catch (err) {
            throw err;
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Reconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        sourceUrl: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        sourceComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        status: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        notes: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        durationHours: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        specimenLengthMillimeters: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        specimenNodeCounts: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE,
        reviewedAt: DataTypes.DATE,
        teamReviewedAt: DataTypes.DATE,
        approvedAt: DataTypes.DATE,
        publishedAt: DataTypes.DATE,
        archivedAt: DataTypes.DATE
    }, {
        tableName: ReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Reconstruction.belongsTo(Neuron, {foreignKey: "neuronId"});
    Reconstruction.belongsTo(User, {foreignKey: "annotatorId", as: "Annotator"});
    Reconstruction.belongsTo(User, {foreignKey: "reviewerId", as: "Reviewer"});
    Reconstruction.belongsTo(User, {foreignKey: "teamReviewerId", as: "TeamReviewer"});
    Reconstruction.belongsTo(SpecimenNode, {foreignKey: "specimenSomaNodeId", as: "Soma"});
    Reconstruction.hasMany(SpecimenNode, {foreignKey: "reconstructionId"});
    Reconstruction.hasOne(SpecimenSpacePrecomputed, {foreignKey: "reconstructionId", as: "Precomputed"});
    Reconstruction.hasOne(AtlasReconstruction, {foreignKey: "reconstructionId"});
};
