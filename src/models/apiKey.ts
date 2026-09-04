import {DataTypes, BelongsToGetAssociationMixin, Op, Sequelize} from "sequelize";
import {createHash} from "crypto";

import {GraphQLError} from "graphql/error";

import {BaseModel} from "./baseModel";
import {ApiKeyPermissionsAll, User} from "./user";
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
            const owner = await User.findByPk(apiKey.userId);

            // userId is nullable, so a key whose owner cannot be resolved is representable.  It authenticates as null
            // today, which app.ts turns into SystemNoUser; calling the view method on nothing would turn an invalid
            // credential into a 500 raised inside context construction.
            if (!owner) {
                return null;
            }

            // The key's own value, honored directly: no intersection with what the owner holds now and no fallback to
            // it.  The key is the credential.
            return owner.withKeyPermissions(apiKey.permissions);
        }

        if (ServiceOptions.serverAuthenticationKey != null && key === ServiceOptions.serverAuthenticationKey) {
            return User.SystemInternalUser;
        }

        return null;
    }

    public static async createApiKey(userOrId: User | string, sourceKey: string, description?: string, durationDays?: number, permissions?: number): Promise<ApiKey> {
        const user = await User.findUserOrId(userOrId);

        // Before the transaction opens, and the same shape of test User.updatePermissions applies to a user: the mask
        // refuses any bit outside what a key may hold - admin and the internal bits alike - and the range test closes
        // the int32 wrap that would otherwise let a value at or above 2^31 through it.
        if (permissions !== undefined && permissions !== null
            && (!Number.isInteger(permissions) || permissions < 0 || permissions > ApiKeyPermissionsAll || (permissions & ~ApiKeyPermissionsAll) !== 0)) {
            throw new GraphQLError("That permissions value includes bits an API key cannot hold.", {extensions: {code: 1006}});
        }

        return await ApiKey.sequelize.transaction(async (t) => {
            const expiration = new Date();

            expiration.setDate(expiration.getDate() + (durationDays || 90));

            const keyHash = ApiKey.hashKey(sourceKey);

            const apiKey = await ApiKey.create({
                userId: user.id,
                // The owner's permissions minus anything a key may not carry.  An account holding Admin and nothing
                // else therefore mints an empty key, which is the rule working rather than failing.
                permissions: permissions ?? (user.permissions & ApiKeyPermissionsAll),
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
