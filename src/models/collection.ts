import {Sequelize, DataTypes, HasManyGetAssociationsMixin} from "sequelize";

import {BaseModel, DeleteOutput, EntityMutateOutput} from "./baseModel";
import {Sample} from "./sample";


export type CollectionInput = {
    id?: string;
    name?: string;
    description?: string;
    reference?: string;
}

export class Collection extends BaseModel {
    public name: string;
    public description: string;
    public reference: string;

    public getSamples!: HasManyGetAssociationsMixin<Sample>;

    public static async createWith(collectionInput: CollectionInput): Promise<EntityMutateOutput<Collection>> {
        try {
            if (!collectionInput) {
                return {source: null, error: "Collection properties are a required input"};
            }

            if (!collectionInput.name) {
                return {source: null, error: "name is a required input"};
            }

            const collection = await Collection.create({
                name: collectionInput.name,
                description: collectionInput.description,
                reference: collectionInput.reference,
            });

            return {source: collection, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    };

    public static async updateWith(collectionInput: CollectionInput): Promise<EntityMutateOutput<Collection>> {
        try {
            if (!collectionInput) {
                return {source: null, error: "Collection properties are a required input"};
            }

            if (!collectionInput.id) {
                return {source: null, error: "Collection input must contain the id of the object to update"};
            }

            let row = await Collection.findByPk(collectionInput.id);

            if (!row) {
                return {source: null, error: "The collection could not be found"};
            }

            if (this.isNullOrEmpty(collectionInput.name)) {
                return {source: null, error: "name cannot be empty or null"};
            }

            const collection = await row.update(collectionInput);

            return {source: collection, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    };

    public static async deleteFor(id: string): Promise<DeleteOutput> {
        if (!id || id.length === 0) {
            return null;
        }

        try {
            const count = await Collection.destroy({where: {id}});

            if (count > 0) {
                return {id, error: null}
            }

            return {id, error: "The collection could not be removed."};
        } catch (error) {
            return {id, error: error.message};
        }
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Collection.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: DataTypes.TEXT,
        description: DataTypes.TEXT,
        reference: DataTypes.TEXT
    }, {
        tableName: "Collection",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Collection.hasMany(Sample, {foreignKey: "collectionId"});
};
