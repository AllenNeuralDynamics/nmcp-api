import {BelongsToGetAssociationMixin, DataTypes, Sequelize, Transaction} from "sequelize";
import {GraphQLError} from "graphql/error";
import {v7 as uuidv7} from "uuid";

import {BaseModel} from "./baseModel";
import {Annotation} from "./annotation";
import {AnnotationStatus} from "./annotationStatus";
import {UploadSourceStatuses, User} from "./user";
import {ReconstructionSpace} from "./reconstructionSpace";
import {Neuron} from "./neuron";
import {Specimen} from "./specimen";
import {Genotype} from "./genotype";
import {RawReconstruction} from "./rawReconstruction";
import {RawReconstructionUploadStatus, TerminalRawUploadStatuses} from "./rawReconstructionUploadStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {RawReconstructionUploadTableName} from "./tableNames";
import {GqlFile, UnauthorizedError} from "../graphql/secureResolvers";
import {
    buildSimpleReconstruction,
    parseSwcFile,
    SimpleReconstruction,
    toNodeData,
    toReconstructionRows
} from "../io/simpleReconstruction";
import {parseParquetUpload} from "../io/parquetParser";
import {PortalNode} from "../io/portalFormat";
import {
    postQualityControlDocument,
    publishQualityControlDocument,
    RawUploadFile,
    readUploadFile,
    removeQualityControlDocument,
    uploadFileExists,
    writeUploadFile
} from "../io/rawQualityControlFiles";
import {failureMessage, PrecomputedService, PrecomputedServiceStatus} from "../data-access/precomputedService";
import {
    QualityCheckService,
    QualityCheckServiceResult,
    QualityCheckServiceStatus,
    qualityControlFailureReason,
    QualityControlScore
} from "../data-access/qualityCheckService";
import {CoreServiceOptions} from "../options/coreServicesOptions";

const debug = require("debug")("nmcp:nmcp-api:raw-reconstruction-upload");

export enum RawReconstructionUploadFormat {
    Swc = 100,
    Parquet = 200
}

export type RawReconstructionUploadArgs = {
    annotationId: string;
    notes?: string;
    file: Promise<GqlFile>;
}

/**
 * Before review the portal has no specimen-space upload, and the raw upload is open to the annotator as well as the
 * reviewers.  At every other status it admits, the raw upload follows the specimen-space upload exactly.
 */
export const PreReviewRawUploadSourceStatuses: AnnotationStatus[] = [AnnotationStatus.InProgress, AnnotationStatus.Rejected];

export const RawUploadInProgressCode = 1011;

export const RawUploadServiceIssueCode = 1012;

export const PendingQualityControlBlockMilliseconds = 60 * 60 * 1000;

// The precomputed skeleton for a raw upload is always generated as a single segment.
const RawUploadSkeletonId = 1;

export function serviceIssueError(): GraphQLError {
    return new GraphQLError("There is an issue with the reconstruction services. Please try again later.", {extensions: {code: RawUploadServiceIssueCode}});
}

/**
 * The raw upload gate, for the eager check and the locked re-check.  Permission comes first and does not depend on
 * the status, so a caller who could never upload a raw reconstruction to this annotation is not told where it is.
 * At a review status the order then follows Annotation's assertUploadAllowed: the status (1009), then the review bit
 * UploadSourceStatuses pairs with it.
 */
export function assertRawUploadAllowed(user: User, status: AnnotationStatus, annotatorId: string): void {
    if (!user?.canUploadRawReconstruction(annotatorId)) {
        throw new UnauthorizedError();
    }

    if (PreReviewRawUploadSourceStatuses.includes(status)) {
        return;
    }

    if (!UploadSourceStatuses.get(ReconstructionSpace.Specimen)?.has(status)) {
        throw new GraphQLError(`Uploading the raw reconstruction is not allowed while in ${AnnotationStatus[status]}.`, {extensions: {code: 1009}});
    }

    if (!user.canUploadReconstructionData(ReconstructionSpace.Specimen, status)) {
        throw new UnauthorizedError();
    }
}

/**
 * Every tagged attempt exposes its metadata-portal link, so an upload is refused, before any attempt exists, when
 * the link could not be built or quality control could not run.
 */
export function assertRawQualityControlConfigured(): void {
    const options = CoreServiceOptions.qualityControl;

    if (!options.skeletonOutput || !options.blobOutput || !options.aindMetadataUrl) {
        debug("raw upload quality control is not configured: skeleton output, blob output and metadata url are all required");
        throw serviceIssueError();
    }
}

function isTerminalStatus(status: RawReconstructionUploadStatus): boolean {
    return TerminalRawUploadStatuses.includes(status);
}

// The statuses whose QC document exists, and only these: for every terminal status, the status alone says whether it does.
function publishesQualityControlDocument(status: RawReconstructionUploadStatus): boolean {
    return status == RawReconstructionUploadStatus.Accepted || status == RawReconstructionUploadStatus.FailedQualityControl;
}

type RawReconstructionAttemptShape = {
    annotationId: string;
    sourceFilename: string;
    format: RawReconstructionUploadFormat;
}

type RawReconstructionAttemptOutcome = {
    status: RawReconstructionUploadStatus;
    failureMessage: string | null;
    qcTag?: string | null;
    skeletonId?: number | null;
}

type ReceivedUpload = {
    attempt: RawReconstructionUpload;
    error: unknown | null;
}

export type RawQualityControlOutcome = {
    status: RawReconstructionUploadStatus;
    failureMessage: string | null;
    document?: unknown;
}

export type RawQualityControlWork = {
    upload: RawUploadFile;
    data: SimpleReconstruction;
    soma: PortalNode;
}

const inFlightQualityControl = new Set<string>();

export function qualityControlOutcome(result: QualityCheckServiceResult): RawQualityControlOutcome {
    switch (result.serviceStatus) {
        case QualityCheckServiceStatus.Unavailable:
            return {status: RawReconstructionUploadStatus.FailedQualityControlService, failureMessage: "The quality control service could not be reached."};
        case QualityCheckServiceStatus.Error:
            return {status: RawReconstructionUploadStatus.FailedQualityControlService, failureMessage: `The quality control service returned HTTP ${result.serviceError}.`};
    }

    const output = result.output;

    switch (output.score) {
        case QualityControlScore.Passed:
        case QualityControlScore.PassedWithWarnings:
            return {status: RawReconstructionUploadStatus.Accepted, failureMessage: null, document: output.qualityControl};
        case QualityControlScore.Failed:
            return {status: RawReconstructionUploadStatus.FailedQualityControl, failureMessage: qualityControlFailureReason(output), document: output.qualityControl};
        default:
            // An Error score's document, when there is one, can describe another reconstruction, so it is never published.
            return {status: RawReconstructionUploadStatus.ErroredQualityControl, failureMessage: qualityControlFailureReason(output)};
    }
}

export class RawReconstructionUpload extends BaseModel {
    public annotationId: string;
    public attemptNumber: number;
    public status: RawReconstructionUploadStatus;
    public userId: string;
    public sourceFilename: string;
    public format: RawReconstructionUploadFormat;
    public failureMessage: string;
    public qcTag: string | null;
    public skeletonId: number | null;

    public getUser!: BelongsToGetAssociationMixin<User>;
    public getAnnotation!: BelongsToGetAssociationMixin<Annotation>;

    public User?: User;
    public Annotation?: Annotation;

    public static async fromSwcUpload(user: User, args: RawReconstructionUploadArgs): Promise<RawReconstructionUpload> {
        return await this.receiveUpload(user, args, RawReconstructionUploadFormat.Swc);
    }

    public static async fromParquetUpload(user: User, args: RawReconstructionUploadArgs): Promise<RawReconstructionUpload> {
        return await this.receiveUpload(user, args, RawReconstructionUploadFormat.Parquet);
    }

    /**
     * The synchronous half of a raw upload, in one transaction under the annotation lock: the gates, the in-progress
     * gate, parsing, the precomputed skeleton, the hand-off file and the attempt row.  The lock and its pooled
     * connection are held through parsing and the skeleton call, which is why that call has a deadline.  A recorded
     * failure is returned rather than thrown from the callback, so its attempt row commits before the error reaches
     * the caller.
     */
    private static async receiveUpload(user: User, args: RawReconstructionUploadArgs, format: RawReconstructionUploadFormat): Promise<RawReconstructionUpload> {
        if (!args?.file) {
            throw new Error(format == RawReconstructionUploadFormat.Swc ? "The SWC file is missing." : "The Parquet file is missing.");
        }

        const annotation = await Annotation.findByPk(args.annotationId);

        if (!annotation) {
            throw new Error(`Annotation ${args.annotationId} does not exist`);
        }

        assertRawUploadAllowed(user, annotation.status, annotation.annotatorId);

        assertRawQualityControlConfigured();

        const file: any = await args.file;

        const shape: RawReconstructionAttemptShape = {
            annotationId: args.annotationId,
            sourceFilename: file.filename ?? "",
            format
        };

        const received: ReceivedUpload = await this.sequelize.transaction(async (transaction) => {
            const locked = await Annotation.findByPk(args.annotationId, {transaction, lock: Transaction.LOCK.UPDATE});

            if (!locked) {
                throw new Error(`Annotation ${args.annotationId} does not exist`);
            }

            assertRawUploadAllowed(user, locked.status, locked.annotatorId);

            await this.assertNoUploadInProgress(user, locked.id, transaction);

            // A failure row that cannot be written must not replace the error it records.
            const recordFailure = async (outcome: RawReconstructionAttemptOutcome, error: unknown): Promise<ReceivedUpload> => {
                try {
                    return {attempt: await this.writeAttempt(user, shape, outcome, transaction), error};
                } catch (secondary) {
                    debug(`failed to record the failed raw upload for annotation ${shape.annotationId}: ${secondary}`);
                    throw error;
                }
            };

            let data: SimpleReconstruction;

            try {
                data = format == RawReconstructionUploadFormat.Swc
                    ? await parseSwcFile(file.filename, file.createReadStream())
                    : await parseParquetUpload(file.filename, file.createReadStream());

                if (!(data.axon.soma ?? data.dendrite.soma)) {
                    throw new Error("A soma was not found in the uploaded file.");
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);

                return await recordFailure({status: RawReconstructionUploadStatus.FailedUpload, failureMessage: message}, error);
            }

            const qcTag = uuidv7();

            const skeletonSource = `${CoreServiceOptions.qualityControl.skeletonOutput.replace(/\/$/, "")}/precomputed/nmcp-qc-${qcTag}`;

            const rows = toReconstructionRows(data);

            const neuron = await Neuron.findByPk(locked.neuronId, {
                include: [{model: Specimen, as: "Specimen", include: [{model: Genotype}]}],
                transaction
            });

            const skeleton = await PrecomputedService.generateSkeleton(skeletonSource, RawUploadSkeletonId, {
                id: qcTag,
                neuron: {
                    label: neuron?.label ?? "",
                    specimen: {
                        label: neuron?.Specimen?.label ?? "",
                        genotype: neuron?.Specimen?.Genotype?.name ?? null
                    }
                },
                nodes: toNodeData(rows)
            });

            if (skeleton.serviceStatus != PrecomputedServiceStatus.Success) {
                return await recordFailure({
                    status: RawReconstructionUploadStatus.FailedPrecomputed,
                    failureMessage: failureMessage(skeleton),
                    qcTag,
                    skeletonId: RawUploadSkeletonId
                }, serviceIssueError());
            }

            try {
                await writeUploadFile({
                    version: 1,
                    qcTag,
                    annotationId: shape.annotationId,
                    notes: args.notes ?? "",
                    skeletonSource,
                    segmentId: RawUploadSkeletonId,
                    source: data.source,
                    comments: data.comments,
                    rows
                });
            } catch (error) {
                debug(`failed to write the raw upload hand-off file for ${qcTag}: ${error}`);

                return await recordFailure({
                    status: RawReconstructionUploadStatus.FailedQualityControlService,
                    failureMessage: "The upload could not be saved for quality control.",
                    qcTag,
                    skeletonId: RawUploadSkeletonId
                }, serviceIssueError());
            }

            const attempt = await this.writeAttempt(user, shape, {
                status: RawReconstructionUploadStatus.PendingQualityControl,
                failureMessage: null,
                qcTag,
                skeletonId: RawUploadSkeletonId
            }, transaction);

            return {attempt, error: null};
        });

        if (received.error) {
            throw received.error;
        }

        void RawReconstructionUpload.startQualityControl(received.attempt.id);

        return received.attempt;
    }

    /**
     * Must run under the annotation lock.  A recent pending attempt refuses the upload.  An older one is closed, and
     * its QC document removed first, because a crashed run may have published one and the closed status promises none.
     */
    private static async assertNoUploadInProgress(user: User, annotationId: string, transaction: Transaction): Promise<void> {
        const latest = await this.findOne({where: {annotationId}, order: [["attemptNumber", "DESC"]], transaction});

        if (latest?.status != RawReconstructionUploadStatus.PendingQualityControl) {
            return;
        }

        if (Date.now() - new Date(latest.createdAt).getTime() < PendingQualityControlBlockMilliseconds) {
            throw new GraphQLError("A raw reconstruction upload for this annotation is still in quality control. Try again once it finishes.", {extensions: {code: RawUploadInProgressCode}});
        }

        if (latest.qcTag) {
            try {
                await removeQualityControlDocument(latest.qcTag);
            } catch (error) {
                debug(`failed to remove the quality control document of stale raw upload attempt ${latest.id}: ${error}`);
                throw serviceIssueError();
            }
        }

        await latest.recordOutcome(user, RawReconstructionUploadStatus.FailedQualityControlService,
            "Quality control did not finish within an hour and was closed by a newer upload.", transaction);
    }

    /**
     * Runs inside the caller's transaction, which must hold the annotation lock: the lock serializes the numbering
     * between concurrent uploads, and serializes the insert with discard and untraceable, which take the same lock
     * before they soft-delete the history.
     */
    private static async writeAttempt(user: User, shape: RawReconstructionAttemptShape, outcome: RawReconstructionAttemptOutcome, transaction: Transaction): Promise<RawReconstructionUpload> {
        // Soft-deleted rows count: the unique (annotationId, attemptNumber) index covers them.
        const newest = await this.findOne({
            where: {annotationId: shape.annotationId},
            attributes: ["attemptNumber"],
            order: [["attemptNumber", "DESC"]],
            paranoid: false,
            transaction
        });

        const attemptNumber = (newest?.attemptNumber ?? 0) + 1;

        const row = await this.create({
            annotationId: shape.annotationId,
            attemptNumber,
            status: outcome.status,
            userId: user.id,
            sourceFilename: shape.sourceFilename,
            format: shape.format,
            failureMessage: outcome.failureMessage,
            qcTag: outcome.qcTag ?? null,
            skeletonId: outcome.skeletonId ?? null
        }, {transaction});

        await recordEvent({
            kind: EventLogItemKind.RawReconstructionUploadCreate,
            targetId: row.id,
            parentId: shape.annotationId,
            details: {attemptNumber, sourceFilename: shape.sourceFilename, format: shape.format},
            userId: user.id
        }, transaction);

        if (isTerminalStatus(outcome.status)) {
            await row.recordOutcomeEvent(user, outcome.status, outcome.failureMessage, transaction);
        }

        return row;
    }

    public async recordOutcome(user: User, status: RawReconstructionUploadStatus, failureMessage: string | null, transaction: Transaction): Promise<void> {
        if (!isTerminalStatus(status)) {
            throw new Error(`${RawReconstructionUploadStatus[status]} is not an outcome of a raw upload attempt.`);
        }

        await this.update({status, failureMessage}, {transaction});

        await this.recordOutcomeEvent(user, status, failureMessage, transaction);
    }

    private async recordOutcomeEvent(user: User, status: RawReconstructionUploadStatus, failureMessage: string | null, transaction: Transaction): Promise<void> {
        const accepted = status == RawReconstructionUploadStatus.Accepted;

        await recordEvent({
            kind: accepted ? EventLogItemKind.RawReconstructionUploadAccept : EventLogItemKind.RawReconstructionUploadFail,
            targetId: this.id,
            parentId: this.annotationId,
            details: accepted ? null : {status, failureMessage},
            userId: user.id
        }, transaction);
    }

    /**
     * Not awaited by callers.  The in-flight set keeps a startup resume and a fresh hand-off from running one attempt
     * twice in this process, and every error is caught here, so no rejection escapes.
     */
    public static async startQualityControl(attemptId: string): Promise<void> {
        if (inFlightQualityControl.has(attemptId)) {
            return;
        }

        inFlightQualityControl.add(attemptId);

        try {
            await RawReconstructionUpload.runQualityControl(attemptId);
        } catch (error) {
            debug(`quality control for raw upload attempt ${attemptId} did not finish and stays pending: ${error}`);
        } finally {
            inFlightQualityControl.delete(attemptId);
        }
    }

    public static async runQualityControl(attemptId: string): Promise<void> {
        const attempt = await RawReconstructionUpload.findByPk(attemptId);

        if (attempt?.status != RawReconstructionUploadStatus.PendingQualityControl) {
            return;
        }

        let work: RawQualityControlWork;

        try {
            const upload = await readUploadFile(attempt.qcTag);

            const data = buildSimpleReconstruction(upload.source, upload.rows, upload.comments);

            const soma = data.axon.soma ?? data.dendrite.soma;

            if (!soma) {
                throw new Error("the saved upload has no soma");
            }

            work = {upload, data, soma};
        } catch (error) {
            debug(`failed to read the hand-off file for raw upload attempt ${attemptId}: ${error}`);

            await RawReconstructionUpload.completeQualityControl(attempt, {
                status: RawReconstructionUploadStatus.FailedQualityControlService,
                failureMessage: "The saved upload could not be read for quality control."
            }, null);

            return;
        }

        const result = await QualityCheckService.performQualityCheck(attempt.qcTag, toNodeData(work.upload.rows), {
            isRegistered: false,
            skeletonSource: work.upload.skeletonSource,
            segmentIds: [work.upload.segmentId]
        });

        await RawReconstructionUpload.completeQualityControl(attempt, qualityControlOutcome(result), work);
    }

    // The fallback is an ordinary finish with a no-document outcome, so its own compare-and-set decides whether it
    // writes anything, and its removal clears a document the failed primary may have published.
    private static async completeQualityControl(attempt: RawReconstructionUpload, outcome: RawQualityControlOutcome, work: RawQualityControlWork | null): Promise<void> {
        try {
            await RawReconstructionUpload.finishQualityControl(attempt, outcome, work);
        } catch (error) {
            debug(`failed to finish raw upload attempt ${attempt.id} as ${RawReconstructionUploadStatus[outcome.status]}: ${error}`);

            await RawReconstructionUpload.finishQualityControl(attempt, {
                status: RawReconstructionUploadStatus.FailedQualityControlService,
                failureMessage: "Quality control could not be completed."
            }, null);
        }
    }

    /**
     * The locked attempt read is a compare-and-set: an attempt that was discarded, closed by a newer upload, or already
     * finished is left alone, file included.  The file state is settled before any database write, so a terminal
     * status never commits while the document disagrees with it.
     */
    public static async finishQualityControl(attempt: RawReconstructionUpload, outcome: RawQualityControlOutcome, work: RawQualityControlWork | null): Promise<void> {
        const finished: RawReconstructionUpload | null = await RawReconstructionUpload.sequelize.transaction(async (transaction) => {
            // The annotation before the attempt: the upload takes the same order.
            await Annotation.findByPk(attempt.annotationId, {transaction, lock: Transaction.LOCK.UPDATE});

            const locked = await RawReconstructionUpload.findByPk(attempt.id, {transaction, lock: Transaction.LOCK.UPDATE});

            if (locked?.status != RawReconstructionUploadStatus.PendingQualityControl) {
                return null;
            }

            if (publishesQualityControlDocument(outcome.status)) {
                await publishQualityControlDocument(locked.qcTag, outcome.document);
            } else if (locked.qcTag) {
                await removeQualityControlDocument(locked.qcTag);
            }

            const user = (await User.findByPk(locked.userId, {transaction})) ?? User.SystemInternalUser;

            if (outcome.status == RawReconstructionUploadStatus.Accepted) {
                if (!work) {
                    throw new Error(`raw upload attempt ${locked.id} cannot be accepted without its upload`);
                }

                const supersededId = await RawReconstruction.deleteForReplacement(locked.annotationId, transaction);

                await RawReconstruction.createFromParsed(user, {
                    annotationId: locked.annotationId,
                    uploadId: locked.id,
                    notes: work.upload.notes,
                    supersededId
                }, work.data, work.soma, transaction);
            }

            await locked.recordOutcome(user, outcome.status, outcome.failureMessage, transaction);

            return locked;
        });

        if (finished && outcome.status == RawReconstructionUploadStatus.FailedQualityControl) {
            try {
                if (!work) {
                    throw new Error("the upload, and so the skeleton location, is not available");
                }

                await RawReconstructionUpload.postQualityControlToMetadataPortal(finished, outcome.document, work.upload.skeletonSource);
            } catch (error) {
                debug(`failed to post the quality control document of raw upload attempt ${finished.id}: ${error}`);
            }
        }
    }

    // Attempts whose hand-off file is missing stay pending until a newer upload closes them after an hour.
    public static async resumeQualityControl(): Promise<number> {
        const pending = await RawReconstructionUpload.findAll({where: {status: RawReconstructionUploadStatus.PendingQualityControl}});

        let started = 0;

        for (const attempt of pending) {
            if (attempt.qcTag && await uploadFileExists(attempt.qcTag)) {
                void RawReconstructionUpload.startQualityControl(attempt.id);
                started++;
            }
        }

        return started;
    }

    public static async postQualityControlToMetadataPortal(attempt: RawReconstructionUpload, document: unknown, location: string): Promise<void> {
        debug(`posting the quality control document of raw upload attempt ${attempt.id} (qc tag ${attempt.qcTag}) to the metadata portal`);

        await postQualityControlDocument(attempt.qcTag, document, location);
    }

    /**
     * The newest attempt is the highest attemptNumber, never the latest createdAt: timestamps are written from
     * JavaScript at millisecond resolution and from instances whose clocks can disagree.
     */
    public static async findLatestForAnnotation(annotationId: string): Promise<RawReconstructionUpload | null> {
        return await this.findOne({where: {annotationId}, order: [["attemptNumber", "DESC"]]});
    }

    public static async discardForAnnotation(annotationId: string, transaction: Transaction): Promise<void> {
        await this.destroy({where: {annotationId}, transaction});
    }

    public static async copyForRevision(sourceAnnotationId: string, revisionAnnotationId: string, transaction: Transaction): Promise<void> {
        const rows = await this.findAll({where: {annotationId: sourceAnnotationId}, order: [["attemptNumber", "ASC"]], transaction});

        if (rows.length == 0) {
            return;
        }

        // bulkCreate rather than create: save() overwrites updatedAt, and the copies keep both timestamps.
        await this.bulkCreate(rows.map(row => ({...row.toJSON(), id: undefined, annotationId: revisionAnnotationId})), {transaction});
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return RawReconstructionUpload.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        attemptNumber: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        status: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        sourceFilename: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        format: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        failureMessage: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        qcTag: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null
        },
        skeletonId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
        }
    }, {
        tableName: RawReconstructionUploadTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    RawReconstructionUpload.belongsTo(Annotation, {foreignKey: {name: "annotationId", allowNull: false}});
    RawReconstructionUpload.belongsTo(User, {foreignKey: "userId"});
};
