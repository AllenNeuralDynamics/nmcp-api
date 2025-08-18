import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {StructureIdentifier} from "./structureIdentifier";
import {UnregisteredTracing} from "./unregisteredTracing";

export type UnregisteredTracingNodeMutationData = {
    id?: string;
    tracingId: string | null;
    sampleNumber: number;
    parentNumber: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
    structureIdentifierId: string;
}

export class UnregisteredTracingNode extends BaseModel {
    public sampleNumber: number;
    public parentNumber: number;
    public x: number;
    public y: number;
    public z: number;
    public radius: number;
    public lengthToParent: number;
    public structureIdentifierId: string;

    public getStructureIdentifier!: BelongsToGetAssociationMixin<StructureIdentifier>;
    public getTracing!: BelongsToGetAssociationMixin<UnregisteredTracing>;

    public readonly StructureIdentifier?: StructureIdentifier;
}

export const modelInit = (sequelize: Sequelize) => {
    UnregisteredTracingNode.init({
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
    UnregisteredTracingNode.belongsTo(StructureIdentifier, {foreignKey: "structureIdentifierId", as: "StructureIdentifier"});
    UnregisteredTracingNode.belongsTo(UnregisteredTracing, {foreignKey: "tracingId", as: "Tracing"});
};
