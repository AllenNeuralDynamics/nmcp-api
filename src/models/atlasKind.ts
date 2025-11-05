import {BaseModel} from "./baseModel";
import {DataTypes, Sequelize, Transaction} from "sequelize";

import {AtlasKindTableName} from "./tableNames";
import {Atlas} from "./atlas";
import {User} from "./user";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {isNullOrEmpty} from "../util/objectUtil";

export enum AtlasKindId {
    Mouse = 100
}

export enum AtlasKFamilyId {
    Mouse = 100
}

export type AtlasKindShape = {
    name: string;
    description: string;
    kind: AtlasKindId;
    family: AtlasKFamilyId;
}

export class AtlasKind extends BaseModel {
    public name: string;
    public description: string;
    public kind: AtlasKindId;
    public family: AtlasKFamilyId;

    // Not currently exposed to anything other than smartsheet import.  Will need similar createOrUpdate... treatment as specimen/neuron/collection/etc.
    public static async createForShape(shape: AtlasKindShape, user: User, t: Transaction): Promise<AtlasKind> {
        const found = await this.findOne({where: {kind: shape.kind, family: shape.family}});

        if (found) {
            return found;
        }

        if (isNullOrEmpty(shape.name)) {
            throw new Error("Name cannot be empty.");
        }

        const atlasKind = await this.create(shape, {transaction: t});

        await recordEvent({
            kind: EventLogItemKind.AtlasKindCreate,
            targetId: atlasKind.id,
            parentId: null,
            details: shape,
            userId: user.id
        }, t);

        return atlasKind;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return AtlasKind.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        name: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        description: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        kind: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        family: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        tableName: AtlasKindTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    AtlasKind.hasMany(Atlas, {foreignKey: "atlasKindId"});
};
