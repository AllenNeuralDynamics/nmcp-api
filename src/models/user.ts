import {BaseModel, EntityQueryOutput, OffsetAndLimit} from "./baseModel";
import {DataTypes, Op, Sequelize, Transaction} from "sequelize";
import {AtlasReconstruction} from "./atlasReconstruction";
import {Semaphore} from "../util/semaphore";
import {FiniteMap} from "../util/finiteMap";
import {ApiKey} from "./apiKey";
import {UserTableName} from "./tableNames";
import {ReconstructionSpace} from "./reconstructionSpace";
import {AdminDiscardableSourceStatuses, DiscardableSourceStatuses, Reconstruction} from "./reconstruction";
import {ReconstructionStatus} from "./reconstructionStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {PortalUser} from "../io/portalFormat";

const debug = require("debug")("nmcp:nmcp-api:user");

export type UserQueryInput = OffsetAndLimit & {
    includeImported: boolean;
};

export enum UserPermissions {
    None = 0x00,
    AnnotateOne = 0x01,
    // Any view permutations through 0x80
    AnnotateMany = 0x02,
    Edit = 0x10,
    // Any edit permutations through 0x800
    EditAll = Edit,
    PublishReview = 0x100,
    PeerReview = 0x200,
    // Any review permutations through 0x8000
    ReviewAll = PublishReview | PeerReview,
    Admin = 0x1000,
    // Any admin permutations through 0x80000
    AdminAll = Admin,
    InternalAccess = 0x1000000,
    InternalSystem = 0xFFFFFFF
}

// All 4883

export const UserPermissionsAll = UserPermissions.AnnotateOne | UserPermissions.AnnotateMany | UserPermissions.EditAll | UserPermissions.ReviewAll | UserPermissions.AdminAll;

// "019a7d99-202b-7000-8000-000000000000" is the earliest/lowest possible value that is a valid UUIDv7 value.  It can not be generated unless a system clock
// were set and held to the Unix epoch.
const SystemNoUserId = "019a7d99-202b-7000-8000-000000000000";
const SystemInternalId = "019a7d99-202b-7000-8000-000000000010";
const SystemAutomationId = "019a7d99-202b-7000-8000-000000000100";

export type UserShape = {
    id?: string
    emailAddress?: string;
    affiliation?: string;
    permissions?: number;
    isAnonymousForAnnotate?: boolean;
    isAnonymousForPublish?: boolean;
    crossAuthenticationId?: string;
    authDirectoryId?: string;
}

export class User extends BaseModel {
    public firstName: string;
    public lastName: string;
    public emailAddress: string;
    public affiliation: string;
    public permissions: number;
    public isAnonymousForAnnotate: boolean;
    public isAnonymousForPublish: boolean;
    public isSystemUser: boolean;
    public crossAuthenticationId: string;
    public authDirectoryId: string;

    // A bit of a hack for keepin the resolvers simple (see app.ts).
    public ip: string;

    private static _systemNoUser: User = null;
    private static _systemInternalUser: User = null;
    private static _systemAutomationUser: User = null;

    private static userCache: FiniteMap<string, User> = new FiniteMap();

    private static userSemaphores: FiniteMap<string, Semaphore> = new FiniteMap();

    public get DisplayName(): string {
        return this.isSystemUser ? "" : [this.firstName, this.lastName].join(" ");
    }

    public get AffiliatedDisplayName(): string {
        const components = this.affiliation ? [this.DisplayName, this.affiliation] : [this.DisplayName];

        return this.isSystemUser ? "" : [components].join(",");
    }

    public static async findOrCreateUser(authId: string, firstName: string, lastName: string, email: string, substituteUser: User = null): Promise<User> {
        // TODO Reorganize this mess.
        // TODO Also, determine why the front end is calling so much that caching seems needed.
        try {
            if (authId && this.userCache.has(authId)) {
                // Some kind of expiration needed.
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
                const value = this.userCache.get(authId);
                lock.release();
                return value;
            }

            try {
                // Try to match email as a backup
                if (!user && email) {
                    user = await User.findOne({where: {emailAddress: email}});

                    // It is possible to have created the user via email from a smarts sheet or other import, and now they are
                    // actually logging in for the first time w/authentication.
                    if (user && authId) {
                        user = await user.updateForShape({authDirectoryId: authId}, this.SystemInternalUser, substituteUser);
                    }
                }

                if (!user) {
                    user = await this.sequelize.transaction(async (t) => {
                        const shape = {
                            authDirectoryId: authId,
                            firstName: firstName,
                            lastName: lastName,
                            emailAddress: email,
                            permissions: UserPermissions.AnnotateMany,
                            isAnonymousForAnnotation: false,
                            isAnonymousForPublish: false,
                            isSystemUser: false,
                            crossAuthenticationId: null
                        };

                        const created = await this.create(shape, {transaction: t});

                        await recordEvent({
                            kind: EventLogItemKind.UserCreate,
                            targetId: created.id,
                            parentId: null,
                            details: shape,
                            userId: this.SystemInternalUser.id,
                            substituteUserId: substituteUser?.id
                        }, t);

                        return created;
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

                if (authId) {
                    this.userCache.set(authId, user);
                }
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

    public static async findUserOrId(userOrId: User | string): Promise<User> {
        if (typeof userOrId == "string") {
            return await User.findByPk(userOrId);
        }

        return userOrId;
    }

    public static async getAll(input: UserQueryInput): Promise<EntityQueryOutput<User>> {
        const options = input.includeImported ? {where: {}} : {where: {authDirectoryId: {[Op.ne]: null}}};

        options.where["isSystemUser"] = false;

        const count = await this.setSortAndLimiting(options, input);

        const users = await User.findAll(options);

        return {totalCount: count, items: users};
    }

    private async updateForShape(shape: UserShape, updater: User, substituteUser: User = null): Promise<User> {
        // Assumes all shape validation has taken place.  This is just to couple the event log in the transaction.
        return await this.sequelize.transaction(async (t) => {
            const updated = await this.update(shape);

            await recordEvent({
                kind: EventLogItemKind.UserUpdate,
                targetId: this.id,
                parentId: null,
                details: shape,
                userId: updater.id,
                substituteUserId: substituteUser?.id
            }, t);

            return updated;
        });
    }

    public static async updatePermissions(id: string, permissions: number, updater: User): Promise<User> {
        if (!updater?.canEditUsers()) {
            throw new UnauthorizedError();
        }

        let user = await User.findByPk(id);

        if (!user || user.isSystemUser) {
            return null;
        }

        if (!this.userSemaphores.has(user.authDirectoryId)) {
            this.userSemaphores.set(user.authDirectoryId, new Semaphore());
        }

        const lock = this.userSemaphores.get(user.authDirectoryId);

        await lock.acquire();

        try {
            user = await user.updateForShape({permissions: permissions}, updater);

            this.userCache.delete(user.authDirectoryId);
        } catch (error) {
            debug(error);
        } finally {
            lock.release();
        }

        return user;
    }

    public static async updateAnonymization(id: string, anonymousCandidate: boolean, anonymousComplete: boolean, updater: User): Promise<User> {
        if (!updater?.canEditUsers()) {
            throw new UnauthorizedError();
        }

        const user = await User.findByPk(id);

        if (!user || user.isSystemUser) {
            return null;
        }

        const shape = {
            isAnonymousForAnnotation: anonymousCandidate,
            isAnonymousForPublish: anonymousComplete
        };

        return await user.updateForShape(shape, updater);
    }

    public isAdmin(): boolean {
        return (this.permissions & UserPermissions.Admin) != 0;
    }

    public canEditUsers(): boolean {
        return this.isAdmin();
    }

    public canEditCollections(): boolean {
        return this.isAdmin();
    }

    public canOpenIssue(): boolean {
        return this.canViewData();
    }

    public canModifyIssue(): boolean {
        return (this.permissions & UserPermissions.Admin) != 0;
    }

    public canViewAccessRequests(): boolean {
        return (this.permissions & UserPermissions.Admin) != 0;
    }

    public canModifyAccessRequestStatus(): boolean {
        return (this.permissions & UserPermissions.Admin) != 0;
    }

    public canEditSpecimens(): boolean {
        return (this.permissions & UserPermissions.Edit) != 0;
    }

    public canEditNeurons(): boolean {
        return (this.permissions & UserPermissions.Edit) != 0;
    }

    public canImportCandidates(): boolean {
        return (this.permissions & UserPermissions.Edit) != 0;
    }

    public canViewData(): boolean {
        return this.permissions != UserPermissions.None;
    }

    public canAnnotate(): boolean {
        return (this.permissions & (UserPermissions.AnnotateOne | UserPermissions.AnnotateMany)) != 0;
    }

    public canAnnotateMultiple(): boolean {
        return (this.permissions & UserPermissions.AnnotateMany) != 0;
    }

    public canModifyReconstruction(): boolean {
        return (this.permissions & UserPermissions.PublishReview) != 0;
    }

    public canPauseReconstruction(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id;
    }

    public canResumeReconstruction(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id;
    }

    public canDiscardReconstruction(annotatorId: string, status: ReconstructionStatus): boolean {
        if (DiscardableSourceStatuses.includes(status)) {
            return this.isAdmin() || annotatorId == this.id;
        }

        if (AdminDiscardableSourceStatuses.includes(status)) {
            return this.isAdmin();
        }

        return false;
    }

    public canMarkReconstructionUntraceable(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id || (this.permissions & (UserPermissions.PeerReview | UserPermissions.PublishReview)) != 0;
    }

    public canReviseReconstruction(): boolean {
        return this.canAnnotate();
    }

    public canRejectReconstruction(status: ReconstructionStatus): boolean {
        if (this.isAdmin()) {
            return true;
        }

        if (status == ReconstructionStatus.PeerReview) {
            return (this.permissions & UserPermissions.PeerReview) != 0;
        }

        if (status == ReconstructionStatus.PublishReview) {
            return (this.permissions & UserPermissions.PublishReview) != 0;
        }

        return false;
    }

    public canRequestReview(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id;
    }

    public canApproveReconstruction(targetStatus: ReconstructionStatus): boolean {
        if (this.isAdmin()) {
            return true;
        }

        if (targetStatus == ReconstructionStatus.PublishReview) {
            return (this.permissions & UserPermissions.PeerReview) != 0;
        } else if (targetStatus == ReconstructionStatus.Approved) {
            return (this.permissions & UserPermissions.PublishReview) != 0;
        }

        return false
    }

    public canPublish(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.PublishReview) != 0;
    }

    public canValidateDois(): boolean {
        return this.isAdmin();
    }

    public canUploadReconstructionData(space: ReconstructionSpace, currentStatus: ReconstructionStatus): boolean {
        if (space == ReconstructionSpace.Specimen) {
            // The review the reconstruction is actually in is who may rewrite its specimen-space nodes.  No admin
            // bypass: an admin who needs this grants themselves the matching review permission explicitly.
            if (currentStatus == ReconstructionStatus.PeerReview) {
                return (this.permissions & UserPermissions.PeerReview) != 0;
            }

            if (currentStatus == ReconstructionStatus.PublishReview) {
                return (this.permissions & UserPermissions.PublishReview) != 0;
            }

            return false;
        }

        if (space == ReconstructionSpace.Atlas) {
            return this.isAdmin() || (this.permissions & UserPermissions.PublishReview) != 0;
        }

        return false;
    }

    public canRequestReconstructionData(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.InternalAccess) != 0;
    }

    /**
     * A view of this user carrying the address of one request.
     *
     * Users reach a resolver from a cache - SystemNoUser is a singleton shared by every anonymous caller, and
     * authenticated users come from the User cache - so assigning the address to the instance lets concurrent requests
     * overwrite each other's, and a caller can end up counted against someone else's rate-limit window.  Delegating to
     * the cached instance through the prototype chain leaves every attribute and method reading from it while making
     * `ip` an own property of the view, which is the only per-request state there is.  Copying the instance instead
     * would mean rebuilding a Sequelize model on every request for the sake of one field.
     */
    public withRequestAddress(ip: string): User {
        const scoped: User = Object.create(this);

        scoped.ip = ip;

        return scoped;
    }

    public canViewRequestDiagnostics(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.InternalAccess) != 0;
    }

    public canRequestPendingPrecomputed(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.InternalAccess) != 0;
    }

    public canUpdatePrecomputed(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.InternalAccess) != 0;
    }

    public static get SystemNoUser(): User {
        return this._systemNoUser;
    }

    public static get SystemAutomationUser(): User {
        return this._systemAutomationUser;
    }

    public static get SystemInternalUser(): User {
        return this._systemInternalUser;
    }

    private static async verifySystemUser(id: string, permissions: UserPermissions, firstName: string = "", lastName: string = "", t: Transaction = null): Promise<User> {
        const [user] = await this.findOrCreate({
            where: {
                id: id,
            }, defaults: {
                id: id,
                permissions: permissions,
                isSystemUser: true,
                firstName: firstName,
                lastName: lastName
            },
            transaction: t
        });

        return user;
    }

    public static async loadCache() {
        this._systemNoUser = await this.verifySystemUser(SystemNoUserId, UserPermissions.None, "System", "NoUser");

        this._systemAutomationUser = await this.verifySystemUser(SystemAutomationId, UserPermissions.InternalSystem, "System", "Automation");

        this._systemInternalUser = await this.verifySystemUser(SystemInternalId, UserPermissions.InternalSystem, "System", "Internal");
    }

    public toPortalFormat(): PortalUser | null {
        if (this.isSystemUser) {
            return null;
        }

        return  {
            id: this.id,
            displayName: this.DisplayName,
            affiliation: this.affiliation,
            email: this.emailAddress
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return User.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        authDirectoryId: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        crossAuthenticationId: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        firstName: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        lastName: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        emailAddress: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        affiliation: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        permissions: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        isAnonymousForAnnotate: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        isAnonymousForPublish: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        isSystemUser: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        settings: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        favorites: {
            type: DataTypes.JSONB,
            defaultValue: null
        }
    }, {
        tableName: UserTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    User.hasMany(Reconstruction, {foreignKey: "annotatorId", as: "Annotator"});
    User.hasMany(Reconstruction, {foreignKey: "reviewerId", as: "PeerReviewer"});
    User.hasMany(AtlasReconstruction, {foreignKey: "reviewerId", as: "Proofreader"});
    User.hasMany(ApiKey, {foreignKey: "userId"});
};
