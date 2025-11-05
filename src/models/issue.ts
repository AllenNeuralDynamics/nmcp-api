import {BelongsToGetAssociationMixin, DataTypes, Op, Sequelize, Transaction} from "sequelize";

import {IssueTableName} from "./tableNames";
import {BaseModel} from "./baseModel";
import {User} from "./user";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {Neuron} from "./neuron";

const debug = require("debug")("mnb:nmcp-api:issue");

export enum IssueKind {
    Uncategorized = 0,
    Candidate = 100
}

export enum IssueStatus {
    Unreviewed = 0,
    UnderInvestigation = 100,
    Closed = 1000
}

export enum IssueReferenceKind {
    Specimen = 1000,
    Neuron = 2000
}

export enum IssueResolutionKind {
    NotEnoughInformation = 100,
    NoLongerApplicable = 200,
    NotAnIssue = 300,
    NotFixing = 2000,
    Fixed = 5000,
    Other = 9000
}

export type IssueReference = {
    id?: string;
    kind: IssueReferenceKind;
    details?: object;
}

type IssueShape = {
    kind?: IssueKind;
    status?: IssueStatus;
    description?: string;
    resolutionKind?: IssueResolutionKind;
    resolution?: string;
    references?: IssueReference[];
    authorId?: string;
    responderId?: string;
}

export class Issue extends BaseModel {
    kind: IssueKind;
    status: IssueStatus;
    description: string;
    resolutionKind: IssueResolutionKind;
    resolution: string;
    references: IssueReference[];
    authorId: string;
    responderId: string;

    public getAuthor!: BelongsToGetAssociationMixin<User>;

    public readonly author: User;

    private async recordEvent(kind: EventLogItemKind, details: IssueShape, user: User, t: Transaction): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: null,
            details: details,
            userId: user.id
        }, t);
    }

    public static async getOpenCount(): Promise<number> {
        return await Issue.count({
            where: {
                status: {
                    [Op.ne]: IssueStatus.Closed
                }
            }
        });
    }

    public static async getOpen(offset: number = 0, limit: number = 100): Promise<Issue[]> {
        return await Issue.findAll({
            where: {
                status: {
                    [Op.ne]: IssueStatus.Closed
                }
            },
            order: [["issueId", "ASC"]],
            offset: offset,
            limit: limit
        });
    }

    public static async open(user: User, kind: IssueKind, description: string, references: IssueReference[]): Promise<Issue> {
        if (!user?.canOpenIssue()) {
            throw new UnauthorizedError();
        }

        return await this.createOrUpdate(user, null, {
            kind: kind,
            status: IssueStatus.Unreviewed,
            description: description,
            resolution: "",
            references: references,
            authorId: user.id
        }, EventLogItemKind.IssueCreate, true);
    }

    private static async createOrUpdate(user: User, id: string, update: IssueShape, eventKind: EventLogItemKind, allowCreate: boolean = false): Promise<Issue> {
        // No authentication checks.  Must be performed by callers.
        const issue = id ? await Issue.findByPk(id) : null;

        if (!issue && !allowCreate) {
            throw new Error(`No such issue ${id}`);
        }

        return await this.sequelize.transaction(async (t) => {
            let updated: Issue;

            if (!issue) {
                updated = await Issue.create(update);
            } else {
                updated = await issue.update(update);
            }

            await updated.recordEvent(eventKind, update, user, t);

            return updated;
        });
    }

    public static async modifyStatus(user: User, id: string, status: IssueStatus): Promise<Issue> {
        if (!user?.canModifyIssue()) {
            throw new UnauthorizedError();
        }

        if (status == IssueStatus.Closed) {
            throw new Error(`closeIssue() must be called to close an issue.`);
        }

        return await this.createOrUpdate(user, id, {
            status: status,
        }, EventLogItemKind.IssueUpdate);
    }

    public static async close(user: User, id: string, resolutionKind: IssueResolutionKind, resolution: string): Promise<Issue> {
        if (!user?.canModifyIssue()) {
            throw new UnauthorizedError();
        }

        return await this.createOrUpdate(user, id, {
            status: IssueStatus.Closed,
            resolutionKind: resolutionKind,
            resolution: resolution,
            responderId: user.id,
        }, EventLogItemKind.IssueClose);
    }

    public async getNeuron(): Promise<Neuron> {
        const reference = this.references?.find(r => r.kind == IssueReferenceKind.Neuron) ?? null;

        return reference ? await Neuron.findByPk(reference.id) : null;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Issue.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        issueId: {
            type: DataTypes.INTEGER
        },
        kind: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        description: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        status: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        resolutionKind: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        resolution: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        references: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
    }, {
        tableName: IssueTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Issue.belongsTo(User, {foreignKey: "authorId", as: "Author"});
    Issue.belongsTo(User, {foreignKey: "responderId", as: "Responder"});
};
