import {BelongsToGetAssociationMixin, DataTypes, Sequelize, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {User} from "./user"
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {AtlasReconstruction} from "./atlasReconstruction";
import {PrecomputedTableName} from "./tableNames";

export enum PrecomputedStatus {
    Initialized = 0,
    Pending = 100,
    Complete = 200,
    FailedToLoad = 300,
    FailedToGenerate = 400
}

export type PrecomputedGenerationStatus = PrecomputedStatus.Complete | PrecomputedStatus.FailedToLoad | PrecomputedStatus.FailedToGenerate;

export class PrecomputedUpdateShape {
    id?: string;
    status?: PrecomputedGenerationStatus;
    version?: number;
    generatedAt?: number;
}

export class Precomputed extends BaseModel {
    public skeletonId?: number;
    public status?: PrecomputedStatus;
    public version?: number;
    public location?: string;   // TODO Store location from precomputed service
    public generatedAt?: Date;
    public reconstructionId?: string;

    public getReconstruction!: BelongsToGetAssociationMixin<AtlasReconstruction>;

    protected async recordEvent(kind: EventLogItemKind, details: object, user: User, t: Transaction): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.reconstructionId,
            details: details,
            userId: user.id
        }, t);
    }

    protected static eventKindForGenerationStatus(status: PrecomputedStatus): EventLogItemKind {
        switch (status) {
            case PrecomputedStatus.Initialized:
                return EventLogItemKind.PrecomputedCreate;
            case PrecomputedStatus.Pending:
                return EventLogItemKind.PrecomputedUpdate;
            case PrecomputedStatus.Complete:
                return EventLogItemKind.PrecomputedComplete;
            case PrecomputedStatus.FailedToLoad:
            case PrecomputedStatus.FailedToGenerate:
                return EventLogItemKind.PrecomputedError;
        }
    }

    protected async precomputedChanged(user: User, complete: boolean, t: Transaction): Promise<void> {
        const reconstruction = await this.getReconstruction({transaction: t});

        await reconstruction.precomputedChanged(user,complete, t);
    }

    public static async getPending(user: User, limit: number = 10): Promise<Precomputed[]> {
        if (!user?.canRequestPendingPrecomputed()) {
            throw new UnauthorizedError();
        }

        return await this.findAll({
            where: {
                "status": PrecomputedStatus.Pending
            },
            limit: limit
        })
    }

    public static async createWithTransaction(user: User, reconstructionId: string, t: Transaction): Promise<Precomputed> {
        const shape = {
            reconstructionId: reconstructionId,
            status: PrecomputedStatus.Initialized
        };

        const precomputed = await this.create(shape, {transaction: t});

        await precomputed.recordEvent(EventLogItemKind.PrecomputedCreate, shape, user, t);

        return precomputed;
    }

    public static async createForReconstruction(user: User, reconstructionId: string, t: Transaction = null): Promise<Precomputed> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, reconstructionId, t);
            })
        } else {
            return await this.createWithTransaction(user, reconstructionId, t);
        }
    }

    public async requestGeneration(user: User, t: Transaction = null): Promise<Precomputed> {
        const update = {"status": PrecomputedStatus.Pending};

        const updated = await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.PrecomputedUpdate, update, user, t);

        return updated;
    }

    public static async updateGeneration(user: User, id: string, status: PrecomputedGenerationStatus, version: number, generatedAt: number): Promise<Precomputed> {
        if (!user?.canUpdatePrecomputed()) {
            throw new UnauthorizedError();
        }

        const precomputed = await this.findByPk(id)

        if (!precomputed) {
            return null;
        }

        return await this.sequelize.transaction(async (t) => {
            const update = {
                status,
                version,
                generatedAt
            }

            const updated = await precomputed.update(update, {transaction: t});

            await updated.recordEvent(this.eventKindForGenerationStatus(status), update, user, t);

            await precomputed.precomputedChanged(user, status == PrecomputedStatus.Complete, t);

            return updated;
        });
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Precomputed.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        skeletonId: {
            type: DataTypes.INTEGER
        },
        status: {
            type: DataTypes.INTEGER
        },
        version: {
            type: DataTypes.INTEGER
        },
        location: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        generatedAt: DataTypes.DATE
    }, {
        tableName: PrecomputedTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Precomputed.belongsTo(AtlasReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};

