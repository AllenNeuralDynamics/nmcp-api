import {Sequelize, DataTypes, HasManyGetAssociationsMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {Tracing} from "./tracing";

export const AxonStructureId = "68e76074-1777-42b6-bbf9-93a6a5f02fa4";

export const DendriteStructureId = "aef2ba31-8f9b-4a47-9de0-58dab1cc06a8";

export class TracingStructure extends BaseModel {
    public id: string;
    public name: string;
    public value: number;

    public getTracings!: HasManyGetAssociationsMixin<Tracing>;
}

export const modelInit = (sequelize: Sequelize) => {
    TracingStructure.init( {
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: DataTypes.TEXT,
        value: DataTypes.INTEGER
    }, {
        tableName: "TracingStructure",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    TracingStructure.hasMany(Tracing, {foreignKey: "tracingStructureId", as: "Tracings"});
};
