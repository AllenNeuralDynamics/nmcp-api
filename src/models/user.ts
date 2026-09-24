import {BaseModel, EntityQueryOutput, OffsetAndLimit} from "./baseModel";
import {DataTypes, Op, Sequelize, Transaction} from "sequelize";
import {GraphQLError} from "graphql/error";
import {AtlasReconstruction} from "./atlasReconstruction";
import {Semaphore} from "../util/semaphore";
import {FiniteMap} from "../util/finiteMap";
import {ApiKey} from "./apiKey";
import {UserTableName} from "./tableNames";
import {ReconstructionSpace} from "./reconstructionSpace";
import {AdminDiscardableSourceStatuses, DiscardableSourceStatuses, Reconstruction} from "./reconstruction";
import {ReconstructionStatus} from "./reconstructionStatus";
import {AbandonableFailureStatuses, AtlasReconstructionStatus} from "./atlasReconstructionStatus";
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
    TeamReview = 0x400,
    // Any review permutations through 0x8000
    ReviewAll = PublishReview | PeerReview | TeamReview,
    Admin = 0x1000,
    // Any admin permutations through 0x80000
    AdminAll = Admin,
    InternalAccess = 0x1000000,
    InternalSystem = 0xFFFFFFF
}

// All (multiple annotations): 5906
// All (single annotation): 5905

export const UserPermissionsAll = UserPermissions.AnnotateOne | UserPermissions.AnnotateMany | UserPermissions.EditAll | UserPermissions.ReviewAll | UserPermissions.AdminAll;

/**
 * UserPermissionsAll is every bit an ordinary account may hold, but AnnotateOne and AnnotateMany are mutually
 * exclusive, so no single account holds all of it.  This is the fullest set one account can actually hold.
 */
export const UserPermissionsMultipleAnnotationsAll = UserPermissions.AnnotateMany | UserPermissions.EditAll | UserPermissions.ReviewAll | UserPermissions.AdminAll;

export const UserPermissionsSingleAnnotationAll = UserPermissions.AnnotateOne | UserPermissions.EditAll | UserPermissions.ReviewAll | UserPermissions.AdminAll;

/**
 * Everything an API key minted for this owner may carry: the owner's annotation variant of the full set, with the admin
 * bits removed.  Admin power is not delegable to a credential - a key is used by a script, unattended, and outlives the
 * session that minted it.  The internal bits are outside both variants and so are outside this too.
 *
 * An owner holding both annotation bits by accident gets the single-annotation variant, the narrower of the two.
 */
export function apiKeyPermissionsAll(ownerPermissions: number): number {
    const annotationAll = (ownerPermissions & UserPermissions.AnnotateOne) !== 0 ? UserPermissionsSingleAnnotationAll : UserPermissionsMultipleAnnotationsAll;

    return annotationAll & ~UserPermissions.AdminAll;
}

/**
 * The source statuses an upload may arrive at, per space, and the review bit each one requires.  A status absent for a
 * space is not an upload source there at all.  The bit tracks the status rather than the space: specimen-space nodes
 * are rewritten by whichever review the reconstruction is actually in, and holding TeamReview is no licence to rewrite
 * specimen data at peer review or atlas data at publish review.  An admin qualifies at any status in the map without
 * holding the bit.
 *
 * Declared here rather than beside the other source-status lists in reconstruction.ts because the values are
 * UserPermissions bits: reconstruction.ts and user.ts form a require cycle, and dereferencing the enum at module scope
 * from that side throws whenever user.js is the entry into it.
 */
export const UploadSourceStatuses: ReadonlyMap<ReconstructionSpace, ReadonlyMap<ReconstructionStatus, UserPermissions>> = new Map([
    [ReconstructionSpace.Specimen, new Map([
        [ReconstructionStatus.PeerReview, UserPermissions.PeerReview],
        [ReconstructionStatus.TeamReview, UserPermissions.TeamReview],
        [ReconstructionStatus.PublishReview, UserPermissions.PublishReview]
    ])],
    [ReconstructionSpace.Atlas, new Map([
        [ReconstructionStatus.TeamReview, UserPermissions.TeamReview],
        [ReconstructionStatus.PublishReview, UserPermissions.PublishReview]
    ])]
]);

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

        // After the target is resolved, so a rejected value cannot distinguish a system user from a missing one, and
        // outside the try below, whose catch would swallow the throw and report success.  The mask refuses any bit
        // outside the normal-user set - including the reserved-but-unassigned ones - and the range test closes the
        // int32 wrap that would otherwise let a value at or above 2^31 through the mask.
        if (!Number.isInteger(permissions) || permissions < 0 || permissions > UserPermissionsAll || (permissions & ~UserPermissionsAll) !== 0) {
            throw new GraphQLError("That permissions value includes bits an ordinary account cannot hold.", {extensions: {code: 1006}});
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

    /**
     * Admin or PublishReview, unlike canModifyReconstruction, which stays PublishReview-only and gates metadata edits.
     * Restarting a phase or replaying the pipeline is a supervisory action on a reconstruction that is stuck, so an
     * admin holding no review bit is still the right person to have it - and the replay must not be more available
     * than the single retry it subsumes.
     */
    public canOperateReconstructionPipeline(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.PublishReview) != 0;
    }

    public canPauseReconstruction(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id;
    }

    public canResumeReconstruction(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id;
    }

    /**
     * Past approval the parent status alone does not decide: WaitingForAtlasReconstruction is abandonable only when the
     * child has stopped at a failed phase, never while one is running.  The annotator is deliberately absent - a
     * reconstruction inside the pipeline is not theirs to abandon.
     */
    private static isReviewerAbandonable(status: ReconstructionStatus, childStatus: AtlasReconstructionStatus): boolean {
        if (status == ReconstructionStatus.ReadyToPublish) {
            return true;
        }

        return status == ReconstructionStatus.WaitingForAtlasReconstruction && AbandonableFailureStatuses.includes(childStatus);
    }

    public canDiscardReconstruction(annotatorId: string, status: ReconstructionStatus, childStatus: AtlasReconstructionStatus = null): boolean {
        if (DiscardableSourceStatuses.includes(status)) {
            return this.isAdmin() || annotatorId == this.id;
        }

        if (AdminDiscardableSourceStatuses.includes(status)) {
            return this.isAdmin();
        }

        if (User.isReviewerAbandonable(status, childStatus)) {
            return this.isAdmin() || (this.permissions & UserPermissions.PublishReview) != 0;
        }

        return false;
    }

    /**
     * The TeamReview bit is deliberately absent.  A team reviewer who finds a neuron untraceable rejects the
     * reconstruction, and the annotator marks it untraceable from Rejected - team review is not a source for the
     * transition either, and from that stage on the atlas child may hold node data a teardown destroys permanently.
     */
    public canMarkReconstructionUntraceable(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id || (this.permissions & (UserPermissions.PeerReview | UserPermissions.PublishReview)) != 0;
    }

    public canReviseReconstruction(): boolean {
        return this.canAnnotate();
    }

    public canRejectReconstruction(status: ReconstructionStatus, childStatus: AtlasReconstructionStatus = null): boolean {
        if (this.isAdmin()) {
            return true;
        }

        if (status == ReconstructionStatus.PeerReview) {
            return (this.permissions & UserPermissions.PeerReview) != 0;
        }

        if (status == ReconstructionStatus.TeamReview) {
            return (this.permissions & UserPermissions.TeamReview) != 0;
        }

        // The PublishFailed pair is spelled out here rather than folded into isReviewerAbandonable, which
        // canDiscardReconstruction shares: a discard permission at PublishFailed would only be refused by
        // Reconstruction.isDiscardable a moment later.
        if (status == ReconstructionStatus.PublishReview
            || User.isReviewerAbandonable(status, childStatus)
            || (status == ReconstructionStatus.PublishFailed && childStatus == AtlasReconstructionStatus.FailedSearchIndexing)) {
            return (this.permissions & UserPermissions.PublishReview) != 0;
        }

        return false;
    }

    public canRequestReview(annotatorId: string): boolean {
        return this.isAdmin() || annotatorId == this.id;
    }

    /**
     * The source decides for the two review sign-offs and the target decides for the final approval, which is why both
     * arguments are present: PublishReview as a target is reachable from peer review and from team review, so the
     * target alone no longer names a bit.  ApprovalSourceStatuses is what refuses an inadmissible pair; this answers
     * only who may act on an admissible one.
     */
    public canApproveReconstruction(targetStatus: ReconstructionStatus, currentStatus: ReconstructionStatus): boolean {
        if (this.isAdmin()) {
            return true;
        }

        if (currentStatus == ReconstructionStatus.PeerReview) {
            return (this.permissions & UserPermissions.PeerReview) != 0;
        }

        if (currentStatus == ReconstructionStatus.TeamReview) {
            return (this.permissions & UserPermissions.TeamReview) != 0;
        }

        if (targetStatus == ReconstructionStatus.Approved) {
            return (this.permissions & UserPermissions.PublishReview) != 0;
        }

        return false
    }

    public canPublish(): boolean {
        return this.isAdmin() || (this.permissions & UserPermissions.PublishReview) != 0;
    }

    /**
     * Admin, or the review bit UploadSourceStatuses pairs with the status the reconstruction is in, for both spaces.
     * The same map decides the locked re-check in Reconstruction.fromParsedStructures, so the rule is stated once.
     */
    public canUploadReconstructionData(space: ReconstructionSpace, currentStatus: ReconstructionStatus): boolean {
        const requiredPermission = UploadSourceStatuses.get(space)?.get(currentStatus);

        if (requiredPermission === undefined) {
            return false;
        }

        return this.isAdmin() || (this.permissions & requiredPermission) != 0;
    }

    /**
     * InternalAccess alone, with no admin bypass, for this and the three gates below.  Each either asserts pipeline
     * state on behalf of a service or exposes internal data to one, and an admin standing in for the internal system
     * user is how precomputed generation gets marked complete with no volume behind it.  An admin who needs
     * automated work redone holds PublishReview and asks for a retry instead.  UserPermissions.InternalSystem
     * includes this bit, so the system users and the internal services are unaffected.
     */
    public canRequestReconstructionData(): boolean {
        return (this.permissions & UserPermissions.InternalAccess) != 0;
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

    /**
     * A view of this user carrying the permissions of the API key a request authenticated with, so that every can...
     * predicate answers off the key rather than off what its owner happens to hold now.
     *
     * The same prototype-chain view withRequestAddress builds, with one difference that is not optional: `ip` is a
     * plain class field, while `permissions` is a Sequelize attribute whose accessor lives on the prototype and writes
     * through to `dataValues` - which this view inherits by reference from the cached user.  A plain assignment would
     * therefore rewrite the permissions of the shared cached instance for every concurrent request on that account.
     * Defining the own property shadows the accessor instead of invoking it.
     */
    public withKeyPermissions(permissions: number): User {
        const scoped: User = Object.create(this);

        Object.defineProperty(scoped, "permissions", {value: permissions, enumerable: true, configurable: true});

        return scoped;
    }

    public canViewRequestDiagnostics(): boolean {
        return (this.permissions & UserPermissions.InternalAccess) != 0;
    }

    public canRequestPendingPrecomputed(): boolean {
        return (this.permissions & UserPermissions.InternalAccess) != 0;
    }

    public canUpdatePrecomputed(): boolean {
        return (this.permissions & UserPermissions.InternalAccess) != 0;
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
    User.hasMany(Reconstruction, {foreignKey: "teamReviewerId", as: "TeamReviewer"});
    User.hasMany(AtlasReconstruction, {foreignKey: "reviewerId", as: "Proofreader"});
    User.hasMany(ApiKey, {foreignKey: "userId"});
};
