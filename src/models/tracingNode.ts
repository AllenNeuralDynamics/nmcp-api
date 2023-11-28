import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {StructureIdentifier} from "./structureIdentifier";
import {Tracing} from "./tracing";
import {BrainArea} from "./brainArea";

export type TracingNodeMutationData = {
    id?: string;
    tracingId: string | null;
    sampleNumber: number;
    parentNumber: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
    brainStructureId: string | null;
}

export class TracingNode extends BaseModel {
    public sampleNumber: number;
    public parentNumber: number;
    public x: number;
    public y: number;
    public z: number;
    public radius: number;
    public lengthToParent: number;
    public brainStructureId: string | null;

    public getStructureIdentifier!: BelongsToGetAssociationMixin<StructureIdentifier>;
    public getTracing!: BelongsToGetAssociationMixin<Tracing>;

    public readonly structureIdentifier?: StructureIdentifier;
}

export const modelInit = (sequelize: Sequelize) => {
    TracingNode.init( {
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
        tableName: "TracingNode",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

export const modelAssociate = () => {
    TracingNode.belongsTo(StructureIdentifier, {foreignKey: "structureIdentifierId"});
    TracingNode.belongsTo(BrainArea, {foreignKey: "brainStructureId"});
    TracingNode.belongsTo(Tracing, {foreignKey: "tracingId", as: "tracing"});
};