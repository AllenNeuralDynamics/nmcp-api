import {BaseModel, EntityQueryOutput, SortAndLimit} from "./baseModel";
import {DataTypes, HasManyGetAssociationsMixin, Sequelize, Op} from "sequelize";
import {Reconstruction} from "./reconstruction";
import {Semaphore} from "../util/semaphore";
import {FiniteMap} from "../util/finiteMap";

const debug = require("debug")("mnb:nmcp-api:user");

export type UserQueryInput = SortAndLimit & {
    includeImported: boolean;
};

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

    private static userCache: FiniteMap<string, User> = new FiniteMap();

    private static userSemaphores: FiniteMap<string, Semaphore> = new FiniteMap();

    public static async findOrCreateUser(authId: string, firstName: string, lastName: string, email: string): Promise<User> {
        try {
            if (this.userCache.has(authId)) {
                return this.userCache.get(authId);
            }

            let user: User = null;

            if (authId) {
                user = await User.findOne({where: {authDirectoryId: authId}});
            }

            // There will be a database action.  Don't allow multiple queries to create race conditions and multiple entries.

            if (!this.userSemaphores.has(authId)) {
                this.userSemaphores.set(authId, new Semaphore());
            }

            const lock = this.userSemaphores.get(authId);

            await lock.acquire();

            // An earlier request may have since created.
            if (this.userCache.has(authId)) {
                return this.userCache.get(authId);
            }

            try {
                // Try to match email as a backup
                if (!user && email) {
                    user = await User.findOne({where: {emailAddress: email}});

                    // It is possible to have created the user via email from a smarts sheet or other import, and now they are
                    // actually logging in for the first time w/authentication.
                    if (user && authId) {
                        await user.update({authDirectoryId: authId});
                    }
                }

                if (!user) {
                    user = await User.create({
                        authDirectoryId: authId,
                        firstName,
                        lastName,
                        emailAddress: email,
                        permissions: UserPermissions.ViewReconstructions,
                        isAnonymousForComplete: false,
                        isAnonymousForCandidate: true,
                        crossAuthenticationId: null
                    });
                    debug(`user ${user.id} for authId ${authId} and email ${email} created`)
                } else {
                    const updates = {}
                    if (firstName) {
                        updates["firstName"] = firstName;
                    }
                    if (lastName) {
                        updates["lastName"] = lastName;
                    }
                    if (email) {
                        updates["emailAddress"] = email;
                    }
                    await user.update(updates);
                }

                this.userCache.set(authId, user);
            } catch (error) {
                debug(error);
            }

            lock.release();

            return user;
        } catch (err) {
            console.log(err);
        }

        return null;
    }

    public static async findUserByEmail(email: string): Promise<User> {
        return await User.findOne({where: {emailAddress: email}});
    }

    public static async getAll(input: UserQueryInput): Promise<EntityQueryOutput<User>> {
        const options = input.includeImported ? {} : {where: {authDirectoryId: {[Op.ne]: null}}};

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
        authDirectoryId: DataTypes.TEXT,
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
