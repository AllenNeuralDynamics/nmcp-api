import {BelongsToGetAssociationMixin, DataTypes, Sequelize, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {QualityControlTableName} from "./tableNames";
import {AtlasReconstruction} from "./atlasReconstruction";
import {AtlasReconstructionStatus} from "./atlasReconstructionStatus";
import {QualityControlStatus} from "./qualityControlStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {User} from "./user";
import {QualityCheckService, QualityCheckServiceStatus, QualityControlScore, QualityOutputShape} from "../data-access/qualityCheckService";
import {failureText, isTransientDatabaseError, PhaseOutcome, phaseFailureMessage} from "../util/phaseFailure";

const debug = require("debug")("nmcp:nmcp-api:quality-control");

function statusForScore(status: QualityControlScore): QualityControlStatus {
    switch (status) {
        case QualityControlScore.Error:
            return QualityControlStatus.Error;
        case QualityControlScore.Failed:
            return QualityControlStatus.Failed;
        case QualityControlScore.Passed:
            return QualityControlStatus.Passed;
        case QualityControlScore.PassedWithWarnings:
            return QualityControlStatus.Passed;
    }
}

/**
 * What the child records about a failed check.  The two failure kinds halt identically and wait for a person, so
 * this text is the only thing that tells a StandardMorph crash apart from a real morphology failure.  Both are
 * composed from the tool's own output, which the ungated qualityControl query already exposes in full.
 */
function failureReasonForOutput(status: QualityControlStatus, output: QualityOutputShape): string | null {
    switch (status) {
        case QualityControlStatus.Error:
            return `quality control tool error (${output.toolError?.kind ?? "unknown"}): ${output.toolError?.description ?? "no description"}`;
        case QualityControlStatus.Failed:
            return `quality control failed ${output.errors?.length ?? 0} test(s): ${(output.errors ?? []).map(test => test.name).join(", ")}`;
        default:
            return null;
    }
}

function eventKindForStatus(status: QualityControlStatus): EventLogItemKind {
    switch (status) {
        case QualityControlStatus.Error:
            return EventLogItemKind.QualityControlError;
        case QualityControlStatus.Failed:
            return EventLogItemKind.QualityControlFailed;
        case QualityControlStatus.Passed:
            return EventLogItemKind.QualityControlPassed;
    }
}

export type QualityControlShape = {
    reconstructionId?: string;
    status: QualityControlStatus;
    current?: QualityOutputShape;
    history?: QualityOutputShape[];
}

export class QualityControl extends BaseModel {
    public status: QualityControlStatus
    public current: QualityOutputShape;
    public history: QualityOutputShape[];
    public reconstructionId: string;

    public getReconstruction!: BelongsToGetAssociationMixin<AtlasReconstruction>;

    private async recordEvent(kind: EventLogItemKind, details: QualityControlShape, user: User, t: Transaction): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.reconstructionId,
            details: details,
            userId: user.id
        }, t);
    }

    private static async createWithTransaction(user: User, reconstructionId: string, t: Transaction): Promise<QualityControl> {
        const shape: QualityControlShape = {
            reconstructionId: reconstructionId,
            status: QualityControlStatus.Pending
        };

        const qualityControl = await this.create(shape, {transaction: t});

        await qualityControl.recordEvent(EventLogItemKind.QualityControlCreate, shape, user, t);

        return qualityControl;
    }

    public static async createForReconstruction(user: User, reconstructionId: string, t: Transaction = null): Promise<QualityControl> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, reconstructionId, t);
            })
        } else {
            return await this.createWithTransaction(user, reconstructionId, t);
        }
    }

    public static async getPending(limit: number = null): Promise<QualityControl[]> {
        return await this.findAll({
            where: {
                status: QualityControlStatus.Pending
            },
            limit: limit
        });
    }

    /**
     * One transaction over both rows: this row's status is what getPending selects on, the child's is the phase
     * pointer the atlasStatus filter and the derived phaseFailure field read.  Compare-and-set on this row only -
     * the child is whatever the pipeline left it, and a claim that won here owns it.
     *
     * The child lock comes first, and unconditionally, even though the compare-and-set below is what decides the
     * claim.  requestPhaseRetry locks the child and then writes this row through its afterReset hook, so taking them
     * in the other order here is a deadlock between a claim and a reassessment.
     */
    public async claim(): Promise<boolean> {
        return await this.sequelize.transaction(async (t) => {
            // reconstructionId on this model is the AtlasReconstruction's id, not the parent Reconstruction's.
            await AtlasReconstruction.findByPk(this.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const [affected] = await QualityControl.update(
                {status: QualityControlStatus.InProgress},
                {where: {id: this.id, status: QualityControlStatus.Pending}, transaction: t}
            );

            if (affected !== 1) {
                return false;
            }

            this.status = QualityControlStatus.InProgress;

            // Conditional: this row's compare-and-set is what decides the claim, and the child is only moved if it is
            // still where the claim expects it.
            await AtlasReconstruction.update(
                {status: AtlasReconstructionStatus.InQualityControl},
                {where: {id: this.reconstructionId, status: AtlasReconstructionStatus.PendingQualityControl}, transaction: t}
            );

            return true;
        });
    }

    // The inverse, in the same lock order, for a claim the phase is handing back.
    public async release(): Promise<void> {
        await this.sequelize.transaction(async (t) => {
            await AtlasReconstruction.findByPk(this.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            await QualityControl.update(
                {status: QualityControlStatus.Pending},
                {where: {id: this.id, status: QualityControlStatus.InProgress}, transaction: t}
            );

            this.status = QualityControlStatus.Pending;

            await AtlasReconstruction.update(
                {status: AtlasReconstructionStatus.PendingQualityControl},
                {where: {id: this.reconstructionId, status: AtlasReconstructionStatus.InQualityControl}, transaction: t}
            );
        });
    }

    /**
     * The quality control half of the worker's pass-boundary sweep.  The child half is covered by
     * AtlasReconstruction.releasePhaseClaims, since InQualityControl is in ClaimedPhaseStatuses.  Selects by status
     * on one table, so it needs no lock ordering.
     */
    public static async releasePhaseClaims(): Promise<number> {
        const [affected] = await this.update(
            {status: QualityControlStatus.Pending},
            {where: {status: QualityControlStatus.InProgress}}
        );

        return affected;
    }

    public async makePending(user: User, t: Transaction = null): Promise<QualityControl> {
        const update = {
            status: QualityControlStatus.Pending
        }

        const qualityControl = await this.update(update, {transaction: t});

        await qualityControl.recordEvent(EventLogItemKind.QualityControlUpdate, update, user, t);

        return qualityControl;
    }

    /**
     * The try opens above performQualityCheck, not below it: that call serializes the reconstruction's nodes before
     * its own try, so a database error or a null soma throws out of it rather than becoming Unavailable.  Left
     * unwrapped it would throw with the worker's claim still held and no failure recorded anywhere.
     */
    public async assess(user: User): Promise<PhaseOutcome> {
        try {
            const {serviceStatus, output} = await QualityCheckService.performQualityCheck(this.reconstructionId);

            if (serviceStatus == QualityCheckServiceStatus.Unavailable || serviceStatus == QualityCheckServiceStatus.Error) {
                await this.release();

                return PhaseOutcome.ServiceUnavailable;
            }

            const update: QualityControlShape = {
                status: statusForScore(output.score),
                current: output,
                history: this.history?.slice() ?? []
            };

            await this.sequelize.transaction(async (t) => {
                if (this.current) {
                    update.history.push(this.current);
                }

                // Child lock first, per the one lock order - the same reason claim() takes it before this row.
                const reconstruction = await AtlasReconstruction.findByPk(this.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

                await this.update(update, {transaction: t});

                await this.recordEvent(eventKindForStatus(update.status), update, user, t);

                await reconstruction.qualityControlChanged(update.status, failureReasonForOutput(update.status, output), user, t);
            });

            return PhaseOutcome.Handled;
        } catch (error) {
            debug(`quality control failed for ${this.id}: ${failureText(error)}`);

            if (isTransientDatabaseError(error)) {
                await this.release();

                return PhaseOutcome.Released;
            }

            // No usable score, so this row leaves the claim at Error - the same value a tool crash produces, since
            // from the row's point of view both mean "the check produced no result".  The pair stays recoverable by
            // hand: qualityControlChanged puts the child at FailedQualityControl, which is what
            // requestQualityControlReassessment guards on.
            await this.sequelize.transaction(async (t) => {
                const reconstruction = await AtlasReconstruction.findByPk(this.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

                await this.update({status: QualityControlStatus.Error}, {transaction: t});

                await reconstruction.qualityControlChanged(
                    QualityControlStatus.Error,
                    phaseFailureMessage("quality control", error),
                    user,
                    t
                );
            });

            return PhaseOutcome.Handled;
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return QualityControl.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        status: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        current: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        history: {
            type: DataTypes.JSONB,
            defaultValue: null
        }
    }, {
        tableName: QualityControlTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    QualityControl.belongsTo(AtlasReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
