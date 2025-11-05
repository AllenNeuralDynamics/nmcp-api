import {Sequelize, DataTypes, FindOrCreateOptions, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {Injection} from "./injection";
import {FluorophoreTableName} from "./tableNames";
import {User} from "./user";
import {EventLogItemKind, recordEvent} from "./eventLogItem";

export class Fluorophore extends BaseModel {
    public name: string;

    public static async findOrCreateFromName(user: User, name: string, specimenId: string, t: Transaction = null): Promise<Fluorophore> {
        const defaults = {name: name};

        const options: FindOrCreateOptions = {
            where: this.duplicateWhereClause(name).where,
            defaults: defaults,
            transaction: t
        };

        const [fluorophore, created] = await this.findOrCreate(options);

        if (created) {
            await recordEvent({
                kind: EventLogItemKind.FluorophoreCreate,
                targetId: fluorophore.id,
                parentId: specimenId,
                details: defaults,
                userId: user.id
            }, t);
        }

        return fluorophore;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Fluorophore.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        name: {
            type: DataTypes.TEXT,
            defaultValue: ""
        }
    }, {
        tableName: FluorophoreTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Fluorophore.hasMany(Injection, {foreignKey: "fluorophoreId"});
};
