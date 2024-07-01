import {BaseModel, EntityQueryOutput, SortAndLimit} from "./baseModel";
import {DataTypes, HasManyGetAssociationsMixin, Sequelize} from "sequelize";
import {Reconstruction} from "./reconstruction";

const debug = require("debug")("mnb:sample-api:user");

export enum UserPermissions {
    None = 0x00,
    View = 0x01,
    // Any view permutations through 0x80
    ViewReconstructions = 0x02,
    ViewAll = View | ViewReconstructions,
    Edit = 0x10,
    // Any edit permutations through 0x800
    EditAll = Edit,
    Review = 0x100,
    // Any review permutations through 0x8000
    ReviewAll = Review,
    Admin = 0x1000,
    // Any admin permutations through 0x80000
    AdminAll = Admin,
    InternalAccess = 0x1000000,
    InternalSystem = 0xFFFFFFF
}

export const UserPermissionsAll = UserPermissions.ViewAll | UserPermissions.EditAll | UserPermissions.ReviewAll | UserPermissions.AdminAll;

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
                permissions: UserPermissions.ViewReconstructions,
                isAnonymousForComplete: false,
                isAnonymousForCandidate: true,
                crossAuthenticationId: null
            });
            debug(`user ${user.id} created`)
        }

        return user;
    }

    public static async getAll(input: SortAndLimit): Promise<EntityQueryOutput<User>> {
        const options = {}

        const count = await this.setSortAndLimiting(options, input);

        const users = await User.findAll(options);

        return {totalCount: count, items: users};
    }

    public static async updatePermissions(id: string, permissions: number): Promise<User> {
        let user = await User.findByPk(id);

        if (user) {
            user = await user.update({
                permissions
            });
        }

        return user;
    }

    public static async updateAnonymity(id: string, anonymousCandidate: boolean, anonymousComplete: boolean): Promise<User> {
        let user = await User.findByPk(id);

        if (user) {
            user = await user.update({
                isAnonymousCandidate: anonymousCandidate,
                isAnonymousComplete: anonymousComplete
            });
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
