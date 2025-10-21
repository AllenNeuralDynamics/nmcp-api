import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {Neuron} from "./neuron";
import {BaseModel} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {Tracing} from "./tracing";
import {AtlasStructure} from "./atlasStructure";

export class SearchContent extends BaseModel {
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

    public brainArea?: AtlasStructure;
    public neuron?: Neuron;
    public tracing?: Tracing;
    public tracingStructure?: TracingStructure;

    public getBrainArea!: BelongsToGetAssociationMixin<AtlasStructure>;
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
        timestamps: true,
        sequelize
    });
};

export const modelAssociate = () => {
    SearchContent.belongsTo(Tracing, {foreignKey: "tracingId", as: "tracing"});
    SearchContent.belongsTo(AtlasStructure, {foreignKey: "brainAreaId", as: "brainArea"});
    SearchContent.belongsTo(Neuron, {foreignKey: "neuronId", as: "neuron"});
    SearchContent.belongsTo(TracingStructure, {foreignKey: "tracingStructureId", as: "tracingStructure"});
};
