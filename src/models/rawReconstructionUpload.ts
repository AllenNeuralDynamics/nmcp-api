import {BelongsToGetAssociationMixin, DataTypes, Sequelize, Transaction} from "sequelize";
import {GraphQLError} from "graphql/error";

import {BaseModel} from "./baseModel";
import {Annotation} from "./annotation";
import {AnnotationStatus} from "./annotationStatus";
import {User} from "./user";
import {RawReconstruction} from "./rawReconstruction";
import {SpecimenSpaceReconstruction} from "./specimenSpaceReconstruction";
import {SpecimenNode} from "./specimenNode";
import {RawReconstructionUploadStatus} from "./rawReconstructionUploadStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {RawReconstructionUploadTableName} from "./tableNames";
import {GqlFile, UnauthorizedError} from "../graphql/secureResolvers";
import {parseSwcFile, SimpleReconstruction} from "../io/simpleReconstruction";
import {parseParquetUpload} from "../io/parquetParser";

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

export const RawUploadSourceStatuses: AnnotationStatus[] = [AnnotationStatus.InProgress, AnnotationStatus.Rejected];

/**
 * The raw upload gate, for the eager check and both locked re-checks.  Permission comes first and does not depend on
 * the status, so a caller who could never upload a raw reconstruction to this annotation is not told where it is.
 */
export function assertRawUploadAllowed(user: User, status: AnnotationStatus, annotatorId: string): void {
    if (!user?.canUploadRawReconstruction(annotatorId)) {
        throw new UnauthorizedError();
    }

    if (!RawUploadSourceStatuses.includes(status)) {
        throw new GraphQLError(`Uploading the raw reconstruction is not allowed while in ${AnnotationStatus[status]}.`, {extensions: {code: 1009}});
    }
}

/**
 * Runs after assertRawUploadAllowed at each of its three call sites, so only a caller who passed the gate learns whether
 * the annotation has specimen-space data.  The specimen-space upload takes the annotation lock before it writes, so the
 * two locked re-checks see any nodes it committed meanwhile.  Nodes rather than the reconstruction row, because every
 * annotation is created with an empty specimen-space row.
 */
export async function assertNoSpecimenSpaceData(annotationId: string, transaction: Transaction = null): Promise<void> {
    const node = await SpecimenNode.findOne({
        attributes: ["id"],
        include: [{model: SpecimenSpaceReconstruction, as: "Reconstruction", where: {annotationId}, attributes: []}],
        transaction
    });

    if (node) {
        throw new GraphQLError("Uploading the raw reconstruction is not allowed once the annotation has specimen-space reconstruction data.", {extensions: {code: 1010}});
    }
}

type RawReconstructionAttemptShape = {
    annotationId: string;
    sourceFilename: string;
    format: RawReconstructionUploadFormat;
}

export class RawReconstructionUpload extends BaseModel {
    public annotationId: string;
    public attemptNumber: number;
    public status: RawReconstructionUploadStatus;
    public userId: string;
    public sourceFilename: string;
    public format: RawReconstructionUploadFormat;
    public failureMessage: string;

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

    private static async receiveUpload(user: User, args: RawReconstructionUploadArgs, format: RawReconstructionUploadFormat): Promise<RawReconstructionUpload> {
        if (!args?.file) {
            throw new Error(format == RawReconstructionUploadFormat.Swc ? "The SWC file is missing." : "The Parquet file is missing.");
        }

        const annotation = await Annotation.findByPk(args.annotationId);

        if (!annotation) {
            throw new Error(`Annotation ${args.annotationId} does not exist`);
        }

        assertRawUploadAllowed(user, annotation.status, annotation.annotatorId);

        await assertNoSpecimenSpaceData(args.annotationId);

        const file: any = await args.file;

        const attempt = await RawReconstructionUpload.createAttempt(user, {
            annotationId: args.annotationId,
            sourceFilename: file.filename ?? "",
            format
        });

        try {
            const data: SimpleReconstruction = format == RawReconstructionUploadFormat.Swc
                ? await parseSwcFile(file.filename, file.createReadStream())
                : await parseParquetUpload(file.filename, file.createReadStream());

            const soma = data.axon.soma ?? data.dendrite.soma;

            if (!soma) {
                throw new Error("A soma was not found in the uploaded file.");
            }

            // Only the annotation's lock, as the specimen-space upload takes, so this cannot join a lock cycle.  The
            // attempt row is written outside this transaction so its status stays current whatever happens here.
            await RawReconstruction.sequelize.transaction(async (transaction) => {
                const locked = await Annotation.findByPk(args.annotationId, {transaction, lock: Transaction.LOCK.UPDATE});

                if (!locked) {
                    throw new Error(`Annotation ${args.annotationId} does not exist`);
                }

                // Re-checked under the lock: parsing is the slow part, and the status can have moved meanwhile.
                assertRawUploadAllowed(user, locked.status, locked.annotatorId);

                await assertNoSpecimenSpaceData(locked.id, transaction);

                const supersededId = await RawReconstruction.deleteForReplacement(args.annotationId, transaction);

                await RawReconstruction.createFromParsed(user, {
                    annotationId: args.annotationId,
                    uploadId: attempt.id,
                    notes: args.notes ?? "",
                    supersededId
                }, data, soma, transaction);
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            try {
                await attempt.recordOutcome(user, RawReconstructionUploadStatus.FailedUpload, message);
            } catch (secondary) {
                debug(`failed to record the failed outcome of raw upload attempt ${attempt.id}: ${secondary}`);
            }

            throw error;
        }

        await attempt.recordOutcome(user, RawReconstructionUploadStatus.Accepted, null);

        return attempt;
    }

    /**
     * Commits the attempt before the file is parsed.  The annotation lock serializes the numbering between concurrent
     * uploads, and serializes the insert with discard and untraceable, which take the same lock before they soft-delete
     * the history.
     */
    private static async createAttempt(user: User, shape: RawReconstructionAttemptShape): Promise<RawReconstructionUpload> {
        return await this.sequelize.transaction(async (transaction) => {
            const locked = await Annotation.findByPk(shape.annotationId, {transaction, lock: Transaction.LOCK.UPDATE});

            if (!locked) {
                throw new Error(`Annotation ${shape.annotationId} does not exist`);
            }

            assertRawUploadAllowed(user, locked.status, locked.annotatorId);

            await assertNoSpecimenSpaceData(locked.id, transaction);

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
                status: RawReconstructionUploadStatus.Uploading,
                userId: user.id,
                sourceFilename: shape.sourceFilename,
                format: shape.format
            }, {transaction});

            await recordEvent({
                kind: EventLogItemKind.RawReconstructionUploadCreate,
                targetId: row.id,
                parentId: shape.annotationId,
                details: {attemptNumber, sourceFilename: shape.sourceFilename, format: shape.format},
                userId: user.id
            }, transaction);

            return row;
        });
    }

    public async recordOutcome(user: User, status: RawReconstructionUploadStatus, failureMessage: string | null): Promise<void> {
        await RawReconstructionUpload.sequelize.transaction(async (transaction) => {
            await this.update({status, failureMessage}, {transaction});

            const accepted = status == RawReconstructionUploadStatus.Accepted;

            await recordEvent({
                kind: accepted ? EventLogItemKind.RawReconstructionUploadAccept : EventLogItemKind.RawReconstructionUploadFail,
                targetId: this.id,
                parentId: this.annotationId,
                details: accepted ? null : {failureMessage},
                userId: user.id
            }, transaction);
        });
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
