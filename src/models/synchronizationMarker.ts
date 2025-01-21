import {DataTypes, Op, Sequelize} from "sequelize";

import {BaseModel} from "./baseModel";

export enum SynchronizationMarkerKind {
    Unknown,
    Neuron = 1,
    Precomputed = 2
}

export class SynchronizationMarker extends BaseModel {
    public markerKind: number;
    appliedAt: Date;

    public static async lastMarker(markerKind: number): Promise<SynchronizationMarker> {
        return await SynchronizationMarker.findOne({
            where: {markerKind: {[Op.eq]: markerKind}}
        })
    }
}

export const modelInit = (sequelize: Sequelize) => {
    SynchronizationMarker.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        markerKind: {
            type: DataTypes.INTEGER
        },
        appliedAt: DataTypes.DATE
    }, {
        tableName: "SynchronizationMarker",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};
