import {DataTypes, Op, Sequelize} from "sequelize";

import {BaseModel} from "./baseModel";
import {SynchronizationMarkerTableName} from "./tableNames";

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

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return SynchronizationMarker.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        markerKind: {
            type: DataTypes.INTEGER
        },
        appliedAt: DataTypes.DATE
    }, {
        tableName: SynchronizationMarkerTableName,
        timestamps: true,
        paranoid: false,
        sequelize
    });
};
