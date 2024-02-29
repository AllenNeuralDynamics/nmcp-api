import {BaseModel} from "./baseModel";
import {DataTypes, HasManyGetAssociationsMixin, Sequelize} from "sequelize";
import {Reconstruction} from "./reconstruction";
const debug = require("debug")("mnb:sample-api:user");

export class User extends BaseModel {
    public firstName: string;
    public lastName: string;
    public emailAddress: string;
    public affiliation: string;
    public permissions: number;
    public isAnonymousForComplete: boolean;
    public isAnonymousForCandidate: boolean;
    public crossAuthenticationId: string;

    public getReconstructions!: HasManyGetAssociationsMixin<Reconstruction>;

    public Reconstructions?: Reconstruction[];

    public static async getUser(userId: string, firstName: string, lastName: string, email: string): Promise<User> {
        let user = await User.findByPk(userId);

        if (!user) {
            debug(`user ${userId} not found`)
            user = await User.create({
                id: userId,
                firstName: firstName,
                lastName: lastName,
                emailAddress: email,
                permissions: 0,
                isAnonymousForComplete: false,
                isAnonymousForCandidate: true,
                crossAuthenticationId: null
            });
            debug(`user ${user.id} created`)
        }

        return user;
    }
}

export const modelInit = (sequelize: Sequelize) => {
    User.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        firstName: DataTypes.TEXT,
        lastName: DataTypes.TEXT,
        emailAddress: DataTypes.TEXT,
        affiliation: DataTypes.TEXT,
        permissions: DataTypes.INTEGER,
        isAnonymousForComplete: DataTypes.BOOLEAN,
        isAnonymousForCandidate: DataTypes.BOOLEAN,
        crossAuthenticationId: DataTypes.TEXT,
    }, {
        tableName: "User",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    User.hasMany(Reconstruction, {foreignKey: "annotatorId", as: "Reconstructions"});
    User.hasMany(Reconstruction, {foreignKey: "proofreaderId", as: "Approvals"});
};
