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
    structureIdentifierId: string;
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
    public structureIdentifierId: string;

    public getStructureIdentifier!: BelongsToGetAssociationMixin<StructureIdentifier>;
    public getTracing!: BelongsToGetAssociationMixin<Tracing>;
    public getBrainArea!: BelongsToGetAssociationMixin<BrainArea>;

    public readonly StructureIdentifier?: StructureIdentifier;
    public readonly BrainArea?: BrainArea;
}

export const modelInit = (sequelize: Sequelize) => {
    TracingNode.init({
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
    TracingNode.belongsTo(StructureIdentifier, {foreignKey: "structureIdentifierId", as: "StructureIdentifier"});
    TracingNode.belongsTo(BrainArea, {foreignKey: "brainStructureId", as: "BrainArea"});
    TracingNode.belongsTo(Tracing, {foreignKey: "tracingId", as: "Tracing"});
};
