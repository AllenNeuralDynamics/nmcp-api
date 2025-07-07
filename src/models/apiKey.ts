import {BaseModel} from "./baseModel";
import {DataTypes, BelongsToGetAssociationMixin, Sequelize} from "sequelize";
import {User} from "./user";

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

export const modelInit = (sequelize: Sequelize) => {
    ApiKey.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
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
        tableName: "ApiKey",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    ApiKey.belongsTo(User, {foreignKey: "userId", as: "User"});
};
