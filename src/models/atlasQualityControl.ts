import {BelongsToGetAssociationMixin, DataTypes, Sequelize, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {AtlasQualityControlTableName} from "./tableNames";
import {AtlasReconstruction} from "./atlasReconstruction";
import {AtlasReconstructionStatus} from "./atlasReconstructionStatus";
import {AtlasQualityControlStatus} from "./atlasQualityControlStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {User} from "./user";
import {
    qualityControlFailureReason,
    QualityCheckService,
    QualityCheckServiceStatus,
    QualityControlOutput,
    QualityControlScore,
    QualityOutputShape
} from "../data-access/qualityCheckService";
import {failureText, isTransientDatabaseError, PhaseOutcome, phaseFailureMessage} from "../util/phaseFailure";

const debug = require("debug")("nmcp:nmcp-api:quality-control");

function statusForScore(status: QualityControlScore): AtlasQualityControlStatus {
    switch (status) {
        case QualityControlScore.Error:
            return AtlasQualityControlStatus.Error;
        case QualityControlScore.Failed:
            return AtlasQualityControlStatus.Failed;
        case QualityControlScore.Passed:
            return AtlasQualityControlStatus.Passed;
        case QualityControlScore.PassedWithWarnings:
            return AtlasQualityControlStatus.Passed;
    }
}

/**
 * What the child records about a failed check.  The two failure kinds halt identically and wait for a person, so
 * this text is the only thing that tells a service error apart from a real morphology failure.  Both are composed
 * from the stored output, which the ungated atlasQualityControl query already exposes in full.  The error's info is
 * left out on purpose: it can carry raw exception text, and this reason is stored on the child and returned publicly.
 */
function failureReasonForOutput(status: AtlasQualityControlStatus, output: QualityControlOutput): string | null {
    switch (status) {
        case AtlasQualityControlStatus.Error:
        case AtlasQualityControlStatus.Failed:
            return qualityControlFailureReason(output);
        default:
            return null;
    }
}

function eventKindForStatus(status: AtlasQualityControlStatus): EventLogItemKind {
    switch (status) {
        case AtlasQualityControlStatus.Error:
            return EventLogItemKind.AtlasQualityControlError;
        case AtlasQualityControlStatus.Failed:
            return EventLogItemKind.AtlasQualityControlFailed;
        case AtlasQualityControlStatus.Passed:
            return EventLogItemKind.AtlasQualityControlPassed;
    }
}

export type AtlasQualityControlShape = {
    reconstructionId?: string;
    status: AtlasQualityControlStatus;
    current?: QualityOutputShape;
    history?: QualityOutputShape[];
}

// An assessment event carries the output's common fields only; the full output stays on the row.
type AtlasQualityControlAssessmentDetails = QualityOutputShape & {
    status: AtlasQualityControlStatus;
}

export class AtlasQualityControl extends BaseModel {
    public status: AtlasQualityControlStatus
    public current: QualityOutputShape;
    public history: QualityOutputShape[];
    public reconstructionId: string;

    public getReconstruction!: BelongsToGetAssociationMixin<AtlasReconstruction>;

    private async recordEvent(kind: EventLogItemKind, details: AtlasQualityControlShape | AtlasQualityControlAssessmentDetails, user: User, t: Transaction): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.reconstructionId,
            details: details,
            userId: user.id
        }, t);
    }

    private static async createWithTransaction(user: User, reconstructionId: string, t: Transaction): Promise<AtlasQualityControl> {
        const shape: AtlasQualityControlShape = {
            reconstructionId: reconstructionId,
            status: AtlasQualityControlStatus.Pending
        };

        const qualityControl = await this.create(shape, {transaction: t});

        await qualityControl.recordEvent(EventLogItemKind.AtlasQualityControlCreate, shape, user, t);

        return qualityControl;
    }

    public static async createForReconstruction(user: User, reconstructionId: string, t: Transaction = null): Promise<AtlasQualityControl> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, reconstructionId, t);
            })
        } else {
            return await this.createWithTransaction(user, reconstructionId, t);
        }
    }

    public static async getPending(limit: number = null): Promise<AtlasQualityControl[]> {
        return await this.findAll({
            where: {
                status: AtlasQualityControlStatus.Pending
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
            // reconstructionId on this model is the AtlasReconstruction's id, not the parent Annotation's.
            await AtlasReconstruction.findByPk(this.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const [affected] = await AtlasQualityControl.update(
                {status: AtlasQualityControlStatus.InProgress},
                {where: {id: this.id, status: AtlasQualityControlStatus.Pending}, transaction: t}
            );

            if (affected !== 1) {
                return false;
            }

            this.status = AtlasQualityControlStatus.InProgress;

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

            await AtlasQualityControl.update(
                {status: AtlasQualityControlStatus.Pending},
                {where: {id: this.id, status: AtlasQualityControlStatus.InProgress}, transaction: t}
            );

            this.status = AtlasQualityControlStatus.Pending;

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
            {status: AtlasQualityControlStatus.Pending},
            {where: {status: AtlasQualityControlStatus.InProgress}}
        );

        return affected;
    }

    public async makePending(user: User, t: Transaction = null): Promise<AtlasQualityControl> {
        const update = {
            status: AtlasQualityControlStatus.Pending
        }

        const qualityControl = await this.update(update, {transaction: t});

        await qualityControl.recordEvent(EventLogItemKind.AtlasQualityControlUpdate, update, user, t);

        return qualityControl;
    }

    /**
     * The try opens above the node serialization: a database error or a null soma there has to be classified like any
     * other failure.  Left unwrapped it would throw with the worker's claim still held and no failure recorded anywhere.
     */
    public async assess(user: User): Promise<PhaseOutcome> {
        try {
            const nodes = await AtlasReconstruction.serializeNodes(User.SystemInternalUser, this.reconstructionId);

            const {serviceStatus, output} = await QualityCheckService.performQualityCheck(this.reconstructionId, nodes, {isRegistered: true});

            if (serviceStatus == QualityCheckServiceStatus.Unavailable || serviceStatus == QualityCheckServiceStatus.Error) {
                await this.release();

                return PhaseOutcome.ServiceUnavailable;
            }

            const update: AtlasQualityControlShape = {
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

                await this.recordEvent(eventKindForStatus(update.status), {
                    status: update.status,
                    serviceVersion: output.serviceVersion,
                    toolVersion: output.toolVersion,
                    when: output.when
                }, user, t);

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

                await this.update({status: AtlasQualityControlStatus.Error}, {transaction: t});

                await reconstruction.qualityControlChanged(
                    AtlasQualityControlStatus.Error,
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
    return AtlasQualityControl.init({
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
        tableName: AtlasQualityControlTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    AtlasQualityControl.belongsTo(AtlasReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
