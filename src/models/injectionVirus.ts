import {Sequelize, DataTypes, FindOrCreateOptions, HasManyGetAssociationsMixin, FindOptions, Op} from "sequelize";

import {BaseModel, EntityMutateOutput, EntityQueryInput} from "./baseModel";
import {optionsIncludeInjectionIds, optionsWhereIds, WithInjectionsQueryInput} from "./findOptions";
import {Injection} from "./injection";
import {Fluorophore} from "./fluorophore";

export type InjectionVirusQueryInput = EntityQueryInput & WithInjectionsQueryInput;

export interface InjectionVirusInput {
    id?: string;
    name?: string;
}

export class InjectionVirus extends BaseModel {
    public name: string;

    public getInjections!: HasManyGetAssociationsMixin<Injection>;

    public static async findId(id: string): Promise<string> {
        return InjectionVirus.findIdWithValidationInternal(InjectionVirus, id);
    }

    public static async findIdWithName(name: string): Promise<string> {
        return (await InjectionVirus.findOne({
            where: {
                name: name
            }
        }))?.id;
    }

    public static async getAll(input: InjectionVirusQueryInput): Promise<InjectionVirus[]> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsIncludeInjectionIds(input, options);

        await this.setSortAndLimiting(options, input);

        return InjectionVirus.findAll(options);
    }

    public static async findDuplicate(name: string): Promise<InjectionVirus> {
        if (!name) {
            return null;
        }

        return InjectionVirus.findOne(InjectionVirus.duplicateWhereClause(name));
    }

    /**
     * Complex where clause to allow for case insensitive requires defaults property.  Wrapping for consistency as
     * a result.
     * @param {InjectionVirusInput} virusInput define name property
     **/

    public static async findOrCreateFromInput(virusInput: InjectionVirusInput): Promise<InjectionVirus> {
        const options: FindOrCreateOptions = {
            where: this.duplicateWhereClause(virusInput.name).where,
            defaults: {name: virusInput.name}
        };

        const [model] = await InjectionVirus.findOrCreate(options);

        return model;
    }

    public static async createWith(virusInput: InjectionVirusInput): Promise<EntityMutateOutput<InjectionVirus>> {
        try {
            if (!virusInput) {
                return {source: null, error: "Injection virus properties are a required input"};
            }

            if (!virusInput.name) {
                return {source: null, error: "name is a required input"};
            }

            const duplicate = await InjectionVirus.findDuplicate(virusInput.name);

            if (duplicate) {
                return {source: null, error: `The name "${virusInput.name}" has already been used`};
            }

            const virus = await InjectionVirus.create({name: virusInput.name});

            return {source: virus, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async updateWith(virusInput: InjectionVirusInput): Promise<EntityMutateOutput<InjectionVirus>> {
        try {
            if (!virusInput) {
                return {source: null, error: "Injection virus properties are a required input"};
            }

            if (!virusInput.id) {
                return {source: null, error: "Virus input must contain the id of the object to update"};
            }

            let row = await InjectionVirus.findByPk(virusInput.id);

            if (!row) {
                return {source: null, error: "The injection virus could not be found"};
            }

            if (this.isNullOrEmpty(virusInput.name)) {
                return {source: null, error: "name cannot be empty"};
            }

            const duplicate = await InjectionVirus.findDuplicate(virusInput.name);

            if (duplicate && duplicate.id !== virusInput.id) {
                return {source: null, error: `The name "${virusInput.name}" has already been used`};
            }

            const virus = await row.update(virusInput);

            return {source: virus, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }
}

export const modelInit = (sequelize: Sequelize) => {
    InjectionVirus.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: DataTypes.TEXT
    }, {
        tableName: "InjectionVirus",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    InjectionVirus.hasMany(Injection, {foreignKey: "injectionVirusId"});
};
