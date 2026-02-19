import {DataTypes, BelongsToGetAssociationMixin, Op, Sequelize} from "sequelize";
import {createHash} from "crypto";

import {BaseModel} from "./baseModel";
import {User} from "./user";
import {ApiKeyTableName} from "./tableNames";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {ServiceOptions} from "../options/serviceOptions";

export class ApiKey extends BaseModel {
    public permissions: number;
    public expiration: Date;
    public description: string;
    public key: string;
    public userId: string;

    public getUser!: BelongsToGetAssociationMixin<User>;

    public User?: User;

    private static hashKey(sourceKey: string): string {
        return createHash("sha512").update(sourceKey).digest("hex");
    }

    public static async findByUserId(userId: string): Promise<ApiKey[]> {
        return await ApiKey.findAll({where: {userId}});
    }

    public static async authenticateKey(key: string): Promise<User> {
        if (!key) {
            return null;
        }

        const keyHash = ApiKey.hashKey(key);

        const apiKey = await ApiKey.findOne({
            where: {
                key: keyHash,
                expiration: {[Op.gt]: new Date()}
            }
        });

        if (apiKey) {
            return await User.findByPk(apiKey.userId);
        }

        if (ServiceOptions.serverAuthenticationKey != null && key === ServiceOptions.serverAuthenticationKey) {
            return User.SystemInternalUser;
        }

        return null;
    }

    public static async createApiKey(userOrId: User | string, sourceKey: string, description?: string, durationDays?: number, permissions?: number): Promise<ApiKey> {
        const user = await User.findUserOrId(userOrId);

        return await ApiKey.sequelize.transaction(async (t) => {
            const expiration = new Date();

            expiration.setDate(expiration.getDate() + (durationDays || 90));

            const keyHash = ApiKey.hashKey(sourceKey);

            const apiKey = await ApiKey.create({
                userId: user.id,
                permissions: permissions ?? user.permissions,
                description,
                expiration,
                key: keyHash
            }, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.ApiKeyCreate,
                targetId: apiKey.id,
                parentId: null,
                details: {description, expiration},
                userId: user.id
            }, t);

            return apiKey;
        });
    }

    public static async deleteApiKey(id: string, userId: string): Promise<boolean> {
        const apiKey = await ApiKey.findByPk(id);

        if (!apiKey) {
            return false;
        }

        if (apiKey.userId !== userId) {
            throw new Error("ApiKey does not belong to the requesting user.");
        }

        return await ApiKey.sequelize.transaction(async (t) => {
            // Ensure a soft-deleted row can't accidentally be used.
            await apiKey.update({key: ""}, {transaction: t});
            await apiKey.destroy({transaction: t});

            await recordEvent({
                kind: EventLogItemKind.ApiKeyDelete,
                targetId: id,
                parentId: null,
                details: {description: apiKey.description},
                userId
            }, t);

            return true;
        });
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return ApiKey.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        key: {
            type: DataTypes.TEXT,
            allowNull: false,
            defaultValue: ""
        },
        permissions: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
        },
        expiration: {
            type: DataTypes.DATE,
            allowNull: true
        },
        description: DataTypes.TEXT,
        userId: {
            type: DataTypes.UUID,
            allowNull: true
        }
    }, {
        tableName: ApiKeyTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    ApiKey.belongsTo(User, {foreignKey: "userId"});
};
