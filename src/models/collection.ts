import {Sequelize, DataTypes} from "sequelize";

import {BaseModel} from "./baseModel";
import {Specimen} from "./specimen";
import {CollectionTableName} from "./tableNames";
import {User} from "./user";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {PortalJsonCollection} from "../io/portalJson";

export type CollectionShape = {
    id?: string;
    name?: string;
    description?: string;
    reference?: string;
}

export class Collection extends BaseModel {
    public name: string;
    public description: string;
    public reference: string;

    public static async findByName(name: string): Promise<Collection> {
        return Collection.findOne({where: {name}});
    }

    private static async createForShape(shape: CollectionShape, user: User, substituteUser: User): Promise<Collection> {
        if (!shape.name || shape.name.trim().length == 0) {
            throw new Error("A collection name is required.");
        }

        return await Collection.sequelize.transaction(async (t) => {
            const collection = await Collection.create(shape, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.CollectionCreate,
                targetId: collection.id,
                parentId: null,
                details: shape,
                userId: user.id,
                substituteUserId: substituteUser?.id
            }, t);

            return collection;
        });
    }

    private async updateForShape(shape: CollectionShape, user: User, substituteUser: User): Promise<Collection> {
        // Can be undefined (no update), but otherwise must be something valid.
        if (shape.name === null || shape.name?.trim().length == 0) {
            delete shape.name;
        }

        return await Collection.sequelize.transaction(async (t) => {
            const collection = await this.update(shape, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.CollectionUpdate,
                targetId: collection.id,
                parentId: null,
                details: shape,
                userId: user.id,
                substituteUserId: substituteUser?.id
            }, t);

            return collection;
        });

    };

    public static async createOrUpdateForShape(user: User, shape: CollectionShape, allowCreate: boolean, substituteUser: User = null): Promise<Collection> {
        if (!substituteUser?.canEditCollections() && !user?.canEditCollections()) {
            throw new UnauthorizedError();
        }

        let collection: Collection;

        if (shape.id) {
            collection = await Collection.findByPk(shape.id);
        }

        if (!collection) {
            return allowCreate ? (await this.createForShape(shape, user, substituteUser)) : null;
        }

        return collection.updateForShape(shape, user, substituteUser);
    }

    public async specimenCount(): Promise<number> {
        return await Specimen.count({where: {collectionId: this.id}});
    }

    public toPortalJson(): PortalJsonCollection{
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            reference: this.reference
        };
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Collection.init({
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
        reference: {
            type: DataTypes.TEXT,
            defaultValue: ""
        }
    }, {
        tableName: CollectionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Collection.hasMany(Specimen, {foreignKey: "collectionId"});
};

const defaultCreateOrUpdateOptions = {
    allowCreate: false,
    substituteUser: null
}
