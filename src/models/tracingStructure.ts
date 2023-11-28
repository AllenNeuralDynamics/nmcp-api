import {Sequelize, DataTypes, HasManyGetAssociationsMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {Tracing} from "./tracing";

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
