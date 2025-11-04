import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {StructureIdentifier} from "./structureIdentifier";
import {UnregisteredReconstruction} from "./unregisteredReconstruction";
import {TracingStructure} from "./tracingStructure";
import {SimpleNode} from "../io/parsedReconstruction";
import {AtlasStructure} from "./atlasStructure";

export type UnregisteredReconstructionNodeInput = {
    sampleNumber: number;
    parentNumber: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
    structureIdentifierId: string;
    tracingStructureId: string;
    atlasStructureId: string;
    reconstructionId: string;
}

export function createUnregisteredReconstructionNodeInput(node: SimpleNode, neuronStructureId: string, reconstructionId: string): UnregisteredReconstructionNodeInput {
    return {
        sampleNumber: node.sampleNumber,
        parentNumber: node.parentNumber,
        structureIdentifierId: StructureIdentifier.idForValue(node.structure),
        x: node.x,
        y: node.y,
        z: node.z,
        radius: node.radius,
        lengthToParent: node.lengthToParent,
        atlasStructureId: node.brainStructureId,
        tracingStructureId: neuronStructureId,
        reconstructionId: reconstructionId
    };
}

export class UnregisteredReconstructionNode extends BaseModel {
    public sampleNumber: number;
    public parentNumber: number;
    public x: number;
    public y: number;
    public z: number;
    public radius: number;
    public lengthToParent: number;
    public structureIdentifierId: string;

    public getStructureIdentifier!: BelongsToGetAssociationMixin<StructureIdentifier>;
    public getNeuronStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<UnregisteredReconstruction>;

    public readonly StructureIdentifier?: StructureIdentifier;
    public readonly NeuronStructure?: TracingStructure;
    public readonly Reconstruction?: UnregisteredReconstruction;
}

export const modelInit = (sequelize: Sequelize) => {
    UnregisteredReconstructionNode.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        sampleNumber: DataTypes.INTEGER,
        parentNumber: DataTypes.INTEGER,
        x: DataTypes.DOUBLE,
        y: DataTypes.DOUBLE,
        z: DataTypes.DOUBLE,
        radius: DataTypes.DOUBLE,
        lengthToParent: DataTypes.DOUBLE
    }, {
        tableName: "UnregisteredNode",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

export const modelAssociate = () => {
    UnregisteredReconstructionNode.belongsTo(StructureIdentifier, {foreignKey: "structureIdentifierId", as: "StructureIdentifier"});
    UnregisteredReconstructionNode.belongsTo(TracingStructure, {foreignKey: "tracingStructureId", as: "NeuronStructure"});
    UnregisteredReconstructionNode.belongsTo(AtlasStructure, {foreignKey: "atlasStructureId", as: "AtlasStructure"});
    UnregisteredReconstructionNode.belongsTo(UnregisteredReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
