import {BelongsToGetAssociationMixin, DataTypes, Sequelize, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {QualityControlTableName} from "./tableNames";
import {AtlasReconstruction} from "./atlasReconstruction";
import {AtlasReconstructionStatus} from "./atlasReconstructionStatus";
import {QualityControlStatus} from "./qualityControlStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {User} from "./user";
import {QualityCheckService, QualityCheckServiceStatus, QualityControlScore, QualityOutputShape} from "../data-access/qualityCheckService";
import {Reconstruction} from "./reconstruction";
import {ReconstructionStatus} from "./reconstructionStatus";
import {UnauthorizedError} from "../graphql/secureResolvers";

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

    public async makePending(user: User, t: Transaction = null): Promise<QualityControl> {
        const update = {
            status: QualityControlStatus.Pending
        }

        const qualityControl = await this.update(update, {transaction: t});

        await qualityControl.recordEvent(EventLogItemKind.QualityControlUpdate, update, user, t);

        return qualityControl;
    }

    public async assess(user: User): Promise<boolean> {
        const {serviceStatus, output} = await QualityCheckService.performQualityCheck(this.reconstructionId);

        if (serviceStatus == QualityCheckServiceStatus.Unavailable || serviceStatus == QualityCheckServiceStatus.Error) {
            return false;
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

            await this.update(update, {transaction: t});

            await this.recordEvent(eventKindForStatus(update.status), update, user, t);

            const reconstruction = await this.getReconstruction();

            await reconstruction.qualityControlChanged(update.status == QualityControlStatus.Passed, user, t);
        });

        return true;
    }

    public static async requestReassessment(user: User, reconstructionId: string): Promise<QualityControl> {
        if (!user?.canModifyReconstruction()) {
            throw new UnauthorizedError();
        }

        const reconstruction = await Reconstruction.findByPk(reconstructionId);

        if (!reconstruction) {
            throw new Error("Reconstruction not found");
        }

        if (reconstruction.status === ReconstructionStatus.Published || reconstruction.status === ReconstructionStatus.Archived) {
            throw new Error("Cannot reassess quality control for a published or archived reconstruction");
        }

        const atlasReconstruction = await AtlasReconstruction.findOne({
            where: {
                reconstructionId: reconstructionId
            }
        });

        if (!atlasReconstruction) {
            throw new Error("No atlas reconstruction found for this reconstruction");
        }

        const qc = await this.findOne({where: {reconstructionId: atlasReconstruction.id}});

        if (!qc) {
            throw new Error("No quality control record found");
        }

        return await this.sequelize.transaction(async (t) => {
            await qc.makePending(user, t);

            await atlasReconstruction.update(
                {status: AtlasReconstructionStatus.PendingQualityControl},
                {transaction: t}
            );

            await recordEvent({
                kind: EventLogItemKind.AtlasReconstructionQualityControlRequest,
                targetId: atlasReconstruction.id,
                parentId: reconstructionId,
                details: {status: AtlasReconstructionStatus.PendingQualityControl},
                userId: user.id
            }, t);

            return qc;
        });
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
