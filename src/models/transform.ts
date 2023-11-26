import {BelongsToGetAssociationMixin, DataTypes, FindOptions, Sequelize} from "sequelize";

import {BaseModel, DeleteOutput, EntityMutateOutput, EntityQueryInput} from "./baseModel";
import {optionsIncludeSampleIds, optionsWhereIds, WithSamplesQueryInput} from "./findOptions";
import {Sample} from "./sample";

export type RegistrationTransformQueryInput = EntityQueryInput & WithSamplesQueryInput;

export interface RegistrationTransformInput {
    id?: string;
    location?: string;
    name?: string;
    notes?: string;
    sampleId?: string;
}

export class RegistrationTransform extends BaseModel {
    public name: string;

    public getSample: BelongsToGetAssociationMixin<Sample>;

    public static async getAll(input: RegistrationTransformQueryInput): Promise<RegistrationTransform[]> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsIncludeSampleIds(input, options);

        await this.setSortAndLimiting(options, input);

        return RegistrationTransform.findAll(options);
    }

    public static async isDuplicate(registrationTransform: RegistrationTransformInput, id: string = null): Promise<boolean> {
        const dupes = await RegistrationTransform.findAll({
            where: {
                sampleId: registrationTransform.sampleId,
                location: registrationTransform.location
            }
        });

        return dupes.length > 0 && (!id || (id !== dupes[0].id));
    }

    public static async createWith(registrationTransform: RegistrationTransformInput, makeActive: boolean): Promise<EntityMutateOutput<RegistrationTransform>> {
        try {
            if (!registrationTransform.location || registrationTransform.location.length === 0) {
                return {source: null, error: "location is a required input"};
            }

            if (await this.isDuplicate(registrationTransform)) {
                return {
                    source: null,
                    error: `The location "${registrationTransform.location}" already exists for this sample`
                };
            }

            const sample = await Sample.findByPk(registrationTransform.sampleId);

            if (!sample) {
                return {source: null, error: "The sample can not be found"};
            }

            const transform = await RegistrationTransform.create({
                location: registrationTransform.location,
                name: registrationTransform.name || "",
                notes: registrationTransform.notes || "",
                sampleId: registrationTransform.sampleId
            });

            return {source: transform, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async updateWith(registrationTransform: RegistrationTransformInput): Promise<EntityMutateOutput<RegistrationTransform>> {
        try {
            let row: RegistrationTransform = await RegistrationTransform.findByPk(registrationTransform.id);

            if (!row) {
                return {source: null, error: "The registration transform could not be found"};
            }

            if (registrationTransform.location && await this.isDuplicate(registrationTransform, registrationTransform.id)) {
                return {source: null, error: `The name "${registrationTransform.location}" has already been used`};
            }

            // Undefined is ok (no update) - null, or empty is not.
            if (registrationTransform.location !== undefined && (registrationTransform.location != null && (registrationTransform.location.length === 0))) {
                return {source: null, error: "Location cannot be empty"};
            }

            // Same as above, but also must be existing sample
            if (registrationTransform.sampleId === null) {
                return {source: null, error: "Sample id cannot be empty"};
            }

            if (registrationTransform.sampleId) {
                if (registrationTransform.location !== undefined && registrationTransform.location.length === 0) {
                    return {source: null, error: "Sample id cannot be empty"};
                }

                const sample = await Sample.findByPk(registrationTransform.sampleId);

                if (!sample) {
                    return {source: null, error: "The sample can not be found"};
                }
            }

            // Undefined is ok (no update) - but prefer not null
            if (registrationTransform.name === null) {
                registrationTransform.name = "";
            }

            if (registrationTransform.notes === null) {
                registrationTransform.notes = "";
            }

            const transform = await row.update(registrationTransform);

            return {source: transform, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async deleteFor(id: string): Promise<DeleteOutput> {
        // Note - there is nothing here to prevent dangling transformed tracings.  Caller assumes responsibility to
        // enforce relationships across database boundaries.
        try {
            if (!id || id.length === 0) {
                return {id, error: "id is a required input"};
            }

            const count = await RegistrationTransform.destroy({where: {id}});

            if (count > 0) {
                return {id, error: null}
            }

            return {id, error: "The registration transform could not be found."};
        } catch (error) {
            return {id, error: error.message};
        }
    }
}

export const modelInit = (sequelize: Sequelize) => {
    RegistrationTransform.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        location: DataTypes.TEXT,
        name: DataTypes.TEXT,
        notes: DataTypes.TEXT,
    }, {
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    RegistrationTransform.belongsTo(Sample, {foreignKey: "sampleId"});
};

/*
export interface ITransform extends Instance<ITransformAttributes>, ITransformAttributes {
    getSample(): ISample;
}

export interface ITransformTable extends Model<ITransform, ITransformAttributes> {
    SampleTable: ISampleTable;

    isDuplicate(transformInput: ITransformAttributes, id?: string): Promise<boolean>;
    createFromInput(transformInput: ITransformAttributes): Promise<ITransform>;
    updateWithData(transformInput: ITransformAttributes): Promise<ITransform>;
    deleteFromInput(transformInput: ITransformAttributes): Promise<number>;
}

export const TableName = "RegistrationTransform";

// noinspection JSUnusedGlobalSymbols
export function sequelizeImport(sequelize, DataTypes: DataTypes): ITransformTable {
    const Transform: ITransformTable = sequelize.define(TableName, {
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        location: DataTypes.TEXT,
        name: DataTypes.TEXT,
        notes: DataTypes.TEXT,
    }, {
        timestamps: true,
        paranoid: true
    });

    Transform.associate = (models: Models) => {
        Transform.belongsTo(models.Sample, {foreignKey: "sampleId", as: "sample"});

        Transform.SampleTable = models.Sample as ISampleTable;
    };

    Transform.SampleTable = null;

    Transform.isDuplicate = async (registrationTransform: ITransformAttributes, id: string = null): Promise<boolean> => {
        const dupes = await Transform.findAll({
            where: {
                sampleId: registrationTransform.sampleId,
                location: registrationTransform.location
            }
        });

        return dupes.length > 0 && (!id || (id !== dupes[0].id));
    };

    Transform.createFromInput = async (registrationTransform: ITransformAttributes): Promise<ITransform> => {
        if (!registrationTransform.location || registrationTransform.location.length === 0) {
            throw {message: "location is a required input"};
        }

        if (await Transform.isDuplicate(registrationTransform)) {
            throw {message: `The location "${registrationTransform.location}" already exists for this sample`};
        }

        const sample = await Transform.SampleTable.findById(registrationTransform.sampleId);

        if (!sample) {
            throw {message: "the sample can not be found"};
        }

        return await Transform.create({
            location: registrationTransform.location,
            name: registrationTransform.name || "",
            notes: registrationTransform.notes || "",
            sampleId: registrationTransform.sampleId
        });
    };

    Transform.updateWithData = async (registrationTransform: ITransformAttributes): Promise<ITransform> => {
        let row: ITransform = await Transform.findById(registrationTransform.id);

        if (!row) {
            throw {message: "The registration transform could not be found"};
        }

        if (registrationTransform.location && await Transform.isDuplicate(registrationTransform, registrationTransform.id)) {
            throw {row, message: `The name "${registrationTransform.location}" has already been used`};
        }

        // Undefined is ok (no update) - null, or empty is not.
        if (registrationTransform.location !== undefined && (registrationTransform.location != null && (registrationTransform.location.length === 0))) {
            throw {row, message: "Location cannot be empty"};
        }

        // Same as above, but also must be existing sample
        if (registrationTransform.sampleId === null) {
            throw {row, message: "Sample id cannot be empty"};
        }

        if (registrationTransform.sampleId) {
            if (registrationTransform.location !== undefined && registrationTransform.location.length === 0) {
                throw {row, message: "Sample id cannot be empty"};
            }

            const sample = await Transform.SampleTable.findById(registrationTransform.sampleId);

            if (!sample) {
                throw {row, message: "The sample can not be found"};
            }
        }

        // Undefined is ok (no update) - but prefer not null
        if (registrationTransform.name === null) {
            registrationTransform.name = "";
        }

        if (registrationTransform.notes === null) {
            registrationTransform.notes = "";
        }

        await row.update(registrationTransform);

        return Transform.findById(row.id);
    };

    Transform.deleteFromInput = async (registrationTransform: ITransformAttributes): Promise<number> => {
        // Note - there is nothing here to prevent dangling transformed tracings.  Caller assumes responsibility to
        // enforce relationships across database boundaries.
        if (!registrationTransform.id || registrationTransform.id.length === 0) {
            throw {message: "id is a required input"};
        }

        return await Transform.destroy({where: {id: registrationTransform.id}});
    };

    return Transform;
}
*/