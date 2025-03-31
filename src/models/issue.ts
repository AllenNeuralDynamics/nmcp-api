import {BelongsToGetAssociationMixin, DataTypes, Op, Sequelize} from "sequelize";

import {IssueTableName} from "./TableNames";
import {BaseModel} from "./baseModel";
import {Neuron} from "./neuron";
import {Reconstruction} from "./reconstruction"
import {User} from "./user";

const debug = require("debug")("mnb:nmcp-api:issue-model");

export enum IssueKind {
    Uncategorized = 0,
    Candidate = 10
}

export enum IssueStatus {
    Unreviewed = 0,
    Closed = 99
}

export class Issue extends BaseModel {
    kind: IssueKind;
    status: IssueStatus;
    description: string;
    response: string;
    responderId: string;

    public getCreator!: BelongsToGetAssociationMixin<User>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;

    public readonly Creator: User;
    public readonly Neuron: Neuron;
    public readonly Reconstruction: Reconstruction;

    public static async getOpen(): Promise<Issue[]> {
        return await Issue.findAll({
            where: {
                status: {
                    [Op.ne]: IssueStatus.Closed
                }
            }
        })
    }

    public static async createWith(creatorId: string, kind: IssueKind,  description: string, neuronId: string = null, reconstructionId: string = null): Promise<Issue> {
        try {
            return await Issue.create({
                kind: kind,
                status: IssueStatus.Unreviewed,
                description: description,
                response: "",
                neuronId: neuronId,
                reconstructionId: reconstructionId,
                creatorId: creatorId
            });

        } catch (error) {
            debug(error);
            return null;
        }
    }

    public static async close(responderId: string, id: string, reason: string): Promise<boolean> {
        try {
            const issue = await Issue.findByPk(id);

            if (issue) {
                await issue.update({
                    status: IssueStatus.Closed,
                    response: reason,
                    responderId: responderId,
                });

                return true;
            }
        } catch (error) {
            debug(error);
        }

        return false;
    }

    public static async updateWith(id: string, status: IssueStatus, description: string): Promise<Issue> {return null}
}

export const modelInit = (sequelize: Sequelize) => {
    Issue.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        kind: DataTypes.INTEGER,
        description: DataTypes.TEXT,
        status: DataTypes.INTEGER,
        response: DataTypes.TEXT,
        responderId: DataTypes.UUID,
    }, {
        tableName: IssueTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Issue.belongsTo(User, {foreignKey: "creatorId", as: "Creator"});
    Issue.belongsTo(Neuron, {foreignKey: "neuronId", as: "Neuron"});
    Issue.belongsTo(Neuron, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
