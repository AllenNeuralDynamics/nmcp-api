import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {Neuron} from "./neuron";
import {BaseModel} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {Tracing} from "./tracing";
import {BrainArea} from "./brainArea";

export interface ISearchContent {
    id?: string;
    visibility: number;
    neuronIdString: string;
    neuronDOI: string;
    neuronConsensus: number;
    somaX: number;
    somaY: number;
    somaZ: number;
    nodeCount: number;
    somaCount: number;
    pathCount: number;
    branchCount: number;
    endCount: number;
    tracingId: string;
    tracingStructureId: string;
    brainAreaId: string;
    neuronId: string;
}

export class SearchContent extends BaseModel {
    public visibility: number;
    public neuronIdString: string;
    public neuronDOI: string;
    public neuronConsensus: number;
    public somaX: number;
    public somaY: number;
    public somaZ: number;
    public nodeCount: number;
    public somaCount: number;
    public pathCount: number;
    public branchCount: number;
    public endCount: number;
    public neuronId: string;

    public brainArea?: BrainArea;
    public neuron?: Neuron;
    public tracing?: Tracing;
    public tracingStructure?: TracingStructure;

    public getBrainArea!: BelongsToGetAssociationMixin<BrainArea>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getTracing!: BelongsToGetAssociationMixin<Tracing>;
    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
}

export const SearchContentModelAttributes = {
    id: {
        primaryKey: true,
        type: DataTypes.UUID
    },
    neuronIdString: DataTypes.TEXT,
    neuronDOI: DataTypes.TEXT,
    visibility: DataTypes.INTEGER,
    neuronConsensus: DataTypes.INTEGER,
    somaX: DataTypes.DOUBLE,
    somaY: DataTypes.DOUBLE,
    somaZ: DataTypes.DOUBLE,
    nodeCount: DataTypes.INTEGER,
    somaCount: DataTypes.INTEGER,
    pathCount: DataTypes.INTEGER,
    branchCount: DataTypes.INTEGER,
    endCount: DataTypes.INTEGER
};

export const modelInit = (sequelize: Sequelize) => {
    SearchContent.init(SearchContentModelAttributes, {
        tableName: "SearchContent",
        timestamps: false,
        sequelize
    });
};

export const modelAssociate = () => {
    SearchContent.belongsTo(Tracing, {foreignKey: "tracingId", as: "tracing"});
    SearchContent.belongsTo(BrainArea, {foreignKey: "brainAreaId", as: "brainArea"});
    SearchContent.belongsTo(Neuron, {foreignKey: "neuronId", as: "neuron"});
    SearchContent.belongsTo(TracingStructure, {foreignKey: "tracingStructureId", as: "tracingStructure"});
};
