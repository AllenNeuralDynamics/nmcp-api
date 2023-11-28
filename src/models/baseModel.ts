import {Sequelize, Model, FindOptions} from "sequelize";
const validate = require("uuid-validate");

export enum EntityType {
    MouseStrain,
    InjectionVirus,
    Fluorophore,
    RegistrationTransform,
    Sample,
    Injection,
    Neuron,
    Tracing
}

export type SortOrder = "ASC" | "DESC";

export type SortAndLimit = {
    sortField?: string;
    sortOrder?: SortOrder;
    offset?: number;
    limit?: number;
}

export type EntityQueryInput = SortAndLimit & {
    ids?: string[];
}

export type EntityQueryOutput<T> = {
    totalCount: number;
    items: T[];
}

export type EntityCount = {
    id: string;
    count: number;
}

export type EntityCountOutput = {
    entityType: EntityType;
    counts: EntityCount[];
    error: string;
}

export interface EntityMutateOutput<T> {
    source: T;
    error: string;
}

export interface DeleteOutput {
    id: string;
    error?: string;
}

export type RawEntityCount = Map<string, number>;

export class BaseModel extends Model {
    public id: string;

    public readonly createdAt: Date;
    public readonly updatedAt: Date;
    public readonly deletedAt: Date;

    protected static async findOneWithValidationInternal(model, id: string) : Promise<BaseModel> {
        if (validate(id, 4)) {
            return model.findByPk(id);
        } else {
            return null;
        }
    }

    protected static async findIdWithValidationInternal(model, id: string) : Promise<string> {
        return (await this.findOneWithValidationInternal(model, id))?.id;
    }

    public static duplicateWhereClause(name: string): FindOptions {
        return {where: Sequelize.where(Sequelize.fn("lower", Sequelize.col("name")), Sequelize.fn("lower", name))};
    }

    /**
     * Primarily used for fields than can be undefined (not included) in an update for create, but if present cannot be
     * null or an empty string.
     * @param str potential field name
     */
    protected static isNullOrEmpty(str: string): boolean {
        return str === null || (str !== undefined && str.length === 0);
    }

    protected static defaultSortField(): string {
        return "createdAt";
    }

    protected static defaultSortOrder(): SortOrder {
        return "ASC";
    }

    protected static async setSortAndLimiting(options: FindOptions, sortAndLimit: SortAndLimit): Promise<number> {
        const totalCount: number = await this.count(options);

        const sortField = (sortAndLimit ? sortAndLimit.sortField : null) || this.defaultSortField();
        const sortOrder: SortOrder = (sortAndLimit ? sortAndLimit.sortOrder : null) || this.defaultSortOrder();

        options.order = [[sortField, sortOrder]];

        options.offset = (sortAndLimit ? sortAndLimit.offset : null) || 0;

        if (options.offset > totalCount) {
            if (totalCount > 0) {
                options.offset = totalCount - 1;
            } else {
                options.offset = 0;
            }
        }

        const limit = (sortAndLimit ? sortAndLimit.limit : null) || null;

        if (limit) {
            options.limit = limit;
        }

        return totalCount;
    }
}
