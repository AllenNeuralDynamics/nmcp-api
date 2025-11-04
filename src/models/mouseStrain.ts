import {Sequelize, DataTypes, HasManyGetAssociationsMixin, FindOrCreateOptions, FindOptions} from "sequelize";

import {BaseModel, EntityMutateOutput, EntityQueryInput} from "./baseModel";
import {optionsIncludeSampleIds, optionsWhereIds, WithSamplesQueryInput} from "./findOptions";
import {Sample} from "./sample";

export type GenotypeQueryInput = EntityQueryInput & WithSamplesQueryInput;

export type GenotypeInput = {
    id?: string;
    name?: string;
}

export class MouseStrain extends BaseModel {
    public name: string;

    public getSamples!: HasManyGetAssociationsMixin<Sample>;

    public static async getAll(input: GenotypeQueryInput): Promise<MouseStrain[]> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsIncludeSampleIds(input, options);

        await this.setSortAndLimiting(options, input);

        return MouseStrain.findAll(options);
    }

    public static async findDuplicate(name: string): Promise<MouseStrain> {
        if (!name) {
            return null;
        }

        return MouseStrain.findOne(this.duplicateWhereClause(name));
    };

    /**
     * Complex where clause to allow for case insensitive requires defaults property.  Wrapping for consistency as
     * a result.
     * @param {GenotypeInput} mouseStrainInput define name property
     **/
    public static async findOrCreateFromInput(mouseStrainInput: GenotypeInput): Promise<MouseStrain> {
        const options: FindOrCreateOptions = {
            where: this.duplicateWhereClause(mouseStrainInput.name).where,
            defaults: {name: mouseStrainInput.name}
        };

        const [model] = await MouseStrain.findOrCreate(options);

        return model;
    }

    public static async createWith(mouseStrainInput: GenotypeInput): Promise<EntityMutateOutput<MouseStrain>> {
        try {
            if (!mouseStrainInput) {
                return {source: null, error: "Mouse strain properties are a required input"};
            }

            if (!mouseStrainInput.name) {
                return {source: null, error: "name is a required input"};
            }

            const duplicate = await MouseStrain.findDuplicate(mouseStrainInput.name);

            if (duplicate) {
                return {source: null, error: `The name "${mouseStrainInput.name}" has already been used`};
            }

            const mouseStrain = await MouseStrain.create({name: mouseStrainInput.name});

            return {source: mouseStrain, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    };

    public static async updateWith(mouseStrainInput: GenotypeInput): Promise<EntityMutateOutput<MouseStrain>> {
        try {
            if (!mouseStrainInput) {
                return {source: null, error: "Mouse strain properties are a required input"};
            }

            if (!mouseStrainInput.id) {
                return {source: null, error: "Mouse strain input must contain the id of the object to update"};
            }

            let row = await MouseStrain.findByPk(mouseStrainInput.id);

            if (!row) {
                return {source: null, error: "The mouse strain could not be found"};
            }

            if (this.isNullOrEmpty(mouseStrainInput.name)) {
                return {source: null, error: "name cannot be empty or null"};
            }

            const duplicate = await MouseStrain.findDuplicate(mouseStrainInput.name);

            if (duplicate && duplicate.id !== mouseStrainInput.id) {
                return {source: null, error: `The strain "${mouseStrainInput.name}" has already been created`};
            }

            const mouseStrain = await row.update(mouseStrainInput);

            return {source: mouseStrain, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    };
}

export const modelInit = (sequelize: Sequelize) => {
    MouseStrain.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: DataTypes.TEXT
    }, {
        tableName: "Genotype",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    MouseStrain.hasMany(Sample, {foreignKey: "mouseStrainId"});
};
