import {Sequelize, DataTypes, BelongsToGetAssociationMixin, HasManyGetAssociationsMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {TracingNode} from "./tracingNode";
import {Neuron} from "./neuron";

export interface ITracingInput {
    id?: string;
    filename?: string;
    fileComments?: string;
    annotator?: string;
    tracingStructureId?: string;
    neuronId?: string;
}

export class Tracing extends BaseModel {
    public id: string;
    public filename: string;
    public fileComments: string;
    public annotator: string;
    public registration?: number;
    public nodeCount?: number;
    public pathCount?: number;
    public branchCount?: number;
    public endCount?: number;
    public somaNodeId: string;

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getNodes!: HasManyGetAssociationsMixin<TracingNode>;
}

export const modelInit = (sequelize: Sequelize) => {
    Tracing.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        filename: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        // comment lines found in SWC file
        fileComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        annotator: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        registration: DataTypes.INTEGER,
        nodeCount: DataTypes.INTEGER,
        pathCount: DataTypes.INTEGER,
        branchCount: DataTypes.INTEGER,
        endCount: DataTypes.INTEGER,
        visibility: DataTypes.INTEGER,
        somaNodeId: DataTypes.UUID,
        nodeLookupAt: DataTypes.DATE,
        searchTransformAt: DataTypes.DATE
    }, {
        tableName: "Tracing",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

export const modelAssociate = () => {
    Tracing.hasMany(TracingNode, {foreignKey: "tracingId", as: "Nodes"});
    Tracing.belongsTo(TracingStructure, {foreignKey: "tracingStructureId"});
    Tracing.belongsTo(Neuron, {foreignKey: "neuronId"});
};
