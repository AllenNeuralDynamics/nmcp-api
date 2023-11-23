import {Sequelize, DataTypes} from "sequelize";
import {searchApiClient} from "../external/searchApiService";

import {BaseModel} from "./baseModel";

const debug = require("debug")("mnb:sample-api:context");

export enum SyncKind {
    None = 0,
    BrainArea = 1,
    StructureIdentifiers = 2,
    TracingStructureIdentifiers = 3,
    Sample = 4,
    Neuron = 5
}

export enum SyncStatus {
    None = 0,
    InProgress = 1,
    Complete = 2,
    TimeOut = 3,
    Error = 4
}

export class SyncHistory extends BaseModel {
    public kind: SyncKind;
    public entity: string;
    public status: SyncStatus;
    public error: string;
    public startedAt: Date;
    public completedAt: Date;

    public static async syncCompartments(): Promise<string> {
        let history: SyncHistory = null;
        let error: string = null;

        try {
            history = await SyncHistory.create({kind: SyncKind.BrainArea, entity: null, status: SyncStatus.None});
        } catch (err) {
            debug(err);
            return err.toString();
        }

        try {
            await history.update({status: SyncStatus.InProgress, startedAt: Date.now()});

            await searchApiClient.syncBrainAreas();

            await history.update({status: SyncStatus.Complete, completedAt: Date.now()});

            return null;
        } catch (err) {
            debug(err);
            error = err.toString();
        }

        try {
            await history.update({status: SyncStatus.Error, error, completedAt: Date.now()});
        } catch (err) {
            debug(err);
        }

        return error;
    }
}

export const modelInit = (sequelize: Sequelize) => {
    SyncHistory.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        kind: DataTypes.INTEGER,
        entity: DataTypes.UUID,
        status: DataTypes.INTEGER,
        error: DataTypes.TEXT,
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE
    }, {
        timestamps: true,
        paranoid: true,
        sequelize
    });
};
