import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {NodeStructure} from "./nodeStructure";
import {NeuronStructure} from "./neuronStructure";
import {RawReconstruction} from "./rawReconstruction";
import {RawReconstructionNodeTableName} from "./tableNames";

export class RawReconstructionNode extends BaseModel {
    public index: number;
    public parentIndex: number;
    public x: number;
    public y: number;
    public z: number;
    public radius: number;
    public lengthToParent: number;
    public nodeStructureId: string;
    public neuronStructureId: string;
    public reconstructionId: string;

    public getNodeStructure!: BelongsToGetAssociationMixin<NodeStructure>;
    public getNeuronStructure!: BelongsToGetAssociationMixin<NeuronStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<RawReconstruction>;

    public readonly NodeStructure?: NodeStructure;
    public readonly NeuronStructure?: NeuronStructure;
    public readonly Reconstruction?: RawReconstruction;
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return RawReconstructionNode.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        index: DataTypes.INTEGER,
        parentIndex: DataTypes.INTEGER,
        x: DataTypes.DOUBLE,
        y: DataTypes.DOUBLE,
        z: DataTypes.DOUBLE,
        radius: DataTypes.DOUBLE,
        lengthToParent: DataTypes.DOUBLE
    }, {
        tableName: RawReconstructionNodeTableName,
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    RawReconstructionNode.belongsTo(NodeStructure, {foreignKey: "nodeStructureId"});
    RawReconstructionNode.belongsTo(NeuronStructure, {foreignKey: "neuronStructureId"});
    RawReconstructionNode.belongsTo(RawReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
