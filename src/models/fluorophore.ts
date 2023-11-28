import {Sequelize, DataTypes, FindOrCreateOptions, HasManyGetAssociationsMixin, FindOptions, Op} from "sequelize";

import {BaseModel, EntityMutateOutput, EntityQueryInput} from "./baseModel";
import {optionsIncludeInjectionIds, optionsWhereIds, WithInjectionsQueryInput} from "./findOptions";
import {Injection} from "./injection";

export type FluorophoreQueryInput = EntityQueryInput & WithInjectionsQueryInput;

export type FluorophoreInput = {
    id?: string;
    name?: string;
}

export class Fluorophore extends BaseModel {
    public name: string;

    public getInjections!: HasManyGetAssociationsMixin<Injection>;

    public static async findId(id: string): Promise<string> {
        return Fluorophore.findIdWithValidationInternal(Fluorophore, id);
    }

    public static async findIdWithName(name: string): Promise<string> {
        return (await Fluorophore.findOne({
            where: {
                name: name
            }
        }))?.id;
    }

    public static async getAll(input: FluorophoreQueryInput): Promise<Fluorophore[]> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsIncludeInjectionIds(input, options);

        await this.setSortAndLimiting(options, input);

        return Fluorophore.findAll(options);
    }

    public static async findDuplicate(name: string): Promise<Fluorophore> {
        if (!name) {
            return null;
        }

        return Fluorophore.findOne(Fluorophore.duplicateWhereClause(name));
    }

    /**
     * Complex where clause to allow for case insensitive requires defaults property.  Wrapping for consistency as
     * a result.
     * @param {FluorophoreInput} fluorophoreInput define name property
     **/
    public static async findOrCreateFromInput(fluorophoreInput: FluorophoreInput): Promise<Fluorophore> {
        const options: FindOrCreateOptions = {
            where: this.duplicateWhereClause(fluorophoreInput.name).where,
            defaults: {name: fluorophoreInput.name}
        };

        const [model] = await Fluorophore.findOrCreate(options);

        return model;
    }

    public static async createWith(fluorophoreInput: FluorophoreInput): Promise<EntityMutateOutput<Fluorophore>> {
        try {
            if (!fluorophoreInput) {
                return {source: null, error: "Fluorophore properties are a required input"};
            }

            if (!fluorophoreInput.name) {
                return {source: null, error: "name is a required input"};
            }

            const duplicate = await Fluorophore.findDuplicate(fluorophoreInput.name);

            if (duplicate) {
                return {source: null, error: `The name "${fluorophoreInput.name}" has already been used`};
            }

            const fluorophore = await Fluorophore.create({name: fluorophoreInput.name});

            return {source: fluorophore, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async updateWith(fluorophoreInput: FluorophoreInput): Promise<EntityMutateOutput<Fluorophore>> {
        try {
            if (!fluorophoreInput) {
                return {source: null, error: "Fluorophore properties are a required input"};
            }

            if (!fluorophoreInput.id) {
                return {source: null, error: "Fluorophore input must contain the id of the object to update"};
            }

            let row = await Fluorophore.findByPk(fluorophoreInput.id);

            if (!row) {
                return {source: null, error: "The fluorophore could not be found"};
            }

            // Undefined is ok - although strange as that is the only property at the moment.
            if (this.isNullOrEmpty(fluorophoreInput.name)) {
                return {source: null, error: "name cannot be empty or null"};
            }

            const duplicate = await Fluorophore.findDuplicate(fluorophoreInput.name);

            if (duplicate && duplicate.id !== fluorophoreInput.id) {
                return {source: null, error: `The name "${fluorophoreInput.name}" has already been used`};
            }

            const fluorophore = await row.update(fluorophoreInput);

            return {source: fluorophore, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Fluorophore.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: DataTypes.TEXT
    }, {
        tableName: "Fluorophore",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Fluorophore.hasMany(Injection, {foreignKey: "fluorophoreId"});
};
