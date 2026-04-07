import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {NodeStructure} from "./nodeStructure";
import {Reconstruction} from "./reconstruction";
import {NeuronStructure} from "./neuronStructure";
import {SpecimenNodeTableName} from "./tableNames";
import {PortalNode} from "../io/portalFormat";

export type SpecimenNodeShape = {
    index: number;
    parentIndex: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
    nodeStructureId: string;
    neuronStructureId: string;
    reconstructionId: string;
}

export function mapToSpecimenNodeShape(node: PortalNode, neuronStructureId: string, reconstructionId: string): SpecimenNodeShape {
    return {
        index: node.index,
        parentIndex: node.parentIndex,
        nodeStructureId: NodeStructure.idForValue(node.structure),
        x: node.x,
        y: node.y,
        z: node.z,
        radius: node.radius,
        lengthToParent: node.lengthToParent,
        neuronStructureId: neuronStructureId,
        reconstructionId: reconstructionId
    };
}

export class SpecimenNode extends BaseModel {
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
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;

    public readonly NodeStructure?: NodeStructure;
    public readonly NeuronStructure?: NeuronStructure;
    public readonly Reconstruction?: Reconstruction;
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return SpecimenNode.init({
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
        tableName: SpecimenNodeTableName,
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    SpecimenNode.belongsTo(NodeStructure, {foreignKey: "nodeStructureId"});
    SpecimenNode.belongsTo(NeuronStructure, {foreignKey: "neuronStructureId"});
    SpecimenNode.belongsTo(Reconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
