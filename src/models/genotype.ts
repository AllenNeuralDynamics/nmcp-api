import {Sequelize, DataTypes, FindOrCreateOptions, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {Specimen} from "./specimen";
import {GenotypeTableName} from "./tableNames";
import {User} from "./user";
import {EventLogItemKind, recordEvent} from "./eventLogItem";

export class Genotype extends BaseModel {
    public name: string;

    /**
     * Complex where clause to allow for case-insensitive requires defaults property.  Wrapping for consistency.
     * @param name matching name
     * @param user the user associated with the creation
     * @param substituteUser optional use that is performing the action on behalf of the actual user (e.g., bulk import tool)
     * @param {Transaction} t optional transaction for multistep operations
     **/
    public static async findOrCreateFromName(user: User, name: string, specimenId: string, substituteUser: User = null, t: Transaction = null): Promise<Genotype> {
        const defaults =  {name: name};

        const options: FindOrCreateOptions = {
            where: this.duplicateWhereClause(name).where,
            defaults: defaults,
            transaction: t
        };

        const [genotype, created] = await this.findOrCreate(options);

        if (created) {
            await recordEvent({
                kind: EventLogItemKind.GenotypeCreate,
                targetId: genotype.id,
                parentId: specimenId,
                details: defaults,
                userId: user.id,
                substituteUserId: substituteUser?.id
            }, t);
        }

        return genotype;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Genotype.init({
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
        tableName: GenotypeTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Genotype.hasMany(Specimen, {foreignKey: "genotypeId"});
};
