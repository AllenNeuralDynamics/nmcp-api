import {BaseModel, EntityQueryOutput, OffsetAndLimit} from "./baseModel";
import {BelongsToGetAssociationMixin, DataTypes, FindOptions, Op, Sequelize, Transaction} from "sequelize";

import {User} from "./user";
import {AccessRequestTableName,} from "./tableNames";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {FiniteMap} from "../util/finiteMap";
import {UnauthorizedError} from "../graphql/secureResolvers";

export enum AccessRequestStatus {
    Unreviewed = 0,
    Pending = 100,
    Accepted = 200,
    Denied = 300
}

export enum RequestAccessResponse {
    Invalid = 0,
    Accepted = 100,
    DuplicateOpen = 200,
    DuplicateApproved = 220,
    DuplicateDenied = 240,
    Throttled = 300
}

export type AccessRequestShape = {
    firstName?: string;
    lastName?: string;
    emailAddress?: string;
    affiliation?: string;
    purpose?: string;
    notes?: string;
    status?: AccessRequestStatus;
    adminId?: string;
}

export type AccessRequestQueryInput = OffsetAndLimit & {
    status?: AccessRequestStatus[];
}

const throttleMap = new FiniteMap<string, [number, Date]>(10);

const fiveMinutesMilliseconds = 5 * 60 * 1000;

export class AccessRequest extends BaseModel {
    public firstName: string;
    public lastName: string;
    public emailAddress: string;
    public affiliation: string;
    public purpose: string;
    public notes: string;
    public status: AccessRequestStatus;
    public adminId: string;
    public assignedId: string;

    public getAdmin!: BelongsToGetAssociationMixin<User>;
    public getAssigned!: BelongsToGetAssociationMixin<User>;

    private async recordEvent(kind: EventLogItemKind, details: AccessRequestShape, user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: null,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, t);
    }

    private static checkThrottle(ip: string): boolean {
        if (throttleMap.has(ip)) {
            const [count, when] = throttleMap.get(ip);

            if (when.valueOf() - Date.now() > fiveMinutesMilliseconds) {
                throttleMap.delete(ip);
                return true;
            }

            throttleMap.set(ip, [count + 1, new Date()]);

            return count < 5;
        }

        throttleMap.set(ip, [1, new Date()]);

        return true;
    }

    public static async createRequest(user: User, data: AccessRequestShape): Promise<RequestAccessResponse> {
        if (!data.emailAddress) {
            return RequestAccessResponse.Invalid;
        }

        if (!this.checkThrottle(user.ip)) {
            return RequestAccessResponse.Throttled;
        }

        const current = await this.findOne({where: {emailAddress: data.emailAddress}});

        if (current) {
            switch (current.status) {
                case AccessRequestStatus.Accepted:
                    return RequestAccessResponse.DuplicateApproved;
                case AccessRequestStatus.Denied:
                    return RequestAccessResponse.DuplicateDenied;
                default:
                    return RequestAccessResponse.DuplicateOpen;
            }
        }

        await this.sequelize.transaction(async (t) => {
            const request = await this.create(data, {transaction: t});

            await request.recordEvent(EventLogItemKind.AccessRequestCreate, data, user, t);

            return request;
        });

        return RequestAccessResponse.Accepted;
    }

    public static async getAll(user: User, input: AccessRequestQueryInput): Promise<EntityQueryOutput<AccessRequest>> {
        if (!user?.canViewAccessRequests()) {
            throw new UnauthorizedError();
        }

        const options: FindOptions = {where: {}};

        if (input?.status?.length > 0) {
            options.where["status"] = {[Op.in]: input.status};
        }

        const totalCount = await this.setSortAndLimiting(options, input);

        const items = await AccessRequest.findAll(options);

        return {totalCount: totalCount, offset: options.offset, items: items};
    }

    public static async updateStatus(user: User, id: string, status: AccessRequestStatus): Promise<AccessRequest> {
        if (!user?.canModifyAccessRequestStatus()) {
            throw new UnauthorizedError();
        }

        if (AccessRequestStatus[status] === undefined) {
            throw new Error(`${status} is not a valid access request status`);
        }

        const request = await AccessRequest.findByPk(id);

        if (!request) {
            throw new Error(`No such access request ${id}`);
        }

        // The admin is whoever last moved the request, not solely whoever approved it, so that a denial is
        // attributable in the same way an approval is.
        const update: AccessRequestShape = {status: status, adminId: user.id};

        return await this.sequelize.transaction(async (t) => {
            const updated = await request.update(update, {transaction: t});

            await updated.recordEvent(eventKindForStatus(status), update, user, t);

            return updated;
        });
    }
}

function eventKindForStatus(status: AccessRequestStatus): EventLogItemKind {
    switch (status) {
        case AccessRequestStatus.Accepted:
            return EventLogItemKind.AccessRequestApprove;
        case AccessRequestStatus.Denied:
            return EventLogItemKind.AccessRequestDeny;
        default:
            return EventLogItemKind.AccessRequestUpdate;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return AccessRequest.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
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
        purpose: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        notes: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        status: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        tableName: AccessRequestTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    // The admin user that approved access.
    AccessRequest.belongsTo(User, {foreignKey: "adminId", as: "Admin"});
    // The user id of the User instance created when approved.
    AccessRequest.belongsTo(User, {foreignKey: "assignedId", as: "Assigned"});
};
