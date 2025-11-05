import {BaseModel} from "./baseModel";
import {DataTypes, BelongsToGetAssociationMixin, Sequelize} from "sequelize";
import {User} from "./user";
import {ApiKeyTableName} from "./tableNames";

export class ApiKey extends BaseModel {
    public permissions: number;
    public expiration: Date;
    public description: string;
    public userId: string;

    public getUser!: BelongsToGetAssociationMixin<User>;

    public User?: User;

    public static async findByUserId(userId: string): Promise<ApiKey[]> {
        return await ApiKey.findAll({where: {userId}});
    }

    public static async createApiKey(userId: string, permissions: number, description?: string, expiration?: Date): Promise<ApiKey> {
        return await ApiKey.create({
            userId,
            permissions,
            description,
            expiration
        });
    }

    public static async deleteApiKey(id: string): Promise<boolean> {
        const apiKey = await ApiKey.findByPk(id);
        if (apiKey) {
            await apiKey.destroy();
            return true;
        }
        return false;
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
