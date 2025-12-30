import {Sequelize, Model, FindOptions, OrderItem} from "sequelize";
import {validate, version} from "uuid";

export type OffsetAndLimit = {
    offset?: number;
    limit?: number;
}

export type EntityQueryInput = OffsetAndLimit & {
    ids?: string[];
}

export type EntityQueryOutput<T> = {
    totalCount: number;
    offset?: number;
    items: T[];
}

export class BaseModel extends Model {
    public id: string;

    public readonly createdAt: Date;
    public readonly updatedAt: Date;
    public readonly deletedAt?: Date;

    public static readonly PreferredDatabaseChunkSize = 25000;

    protected static async findOneWithValidationInternal(model: any, id: string): Promise<BaseModel> {
        if (validate(id) && version(id) == 4) {
            return model.findByPk(id);
        } else {
            return null;
        }
    }

    protected static async findIdWithValidationInternal(model: any, id: string): Promise<string> {
        return (await this.findOneWithValidationInternal(model, id))?.id;
    }

    protected static duplicateWhereClause(name: string): FindOptions {
        return {where: Sequelize.where(Sequelize.fn("lower", Sequelize.col("name")), Sequelize.fn("lower", name))};
    }

    protected static defaultSort(): OrderItem[] {
        return [["createdAt", "ASC"]];
    }

    protected static async setSortAndLimiting(options: FindOptions, offsetAndLimit: OffsetAndLimit, order: OrderItem[] = null): Promise<number> {
        const totalCount: number = await this.count(options);

        options["order"] = order ?? this.defaultSort();

        const limit = offsetAndLimit?.limit ?? null;

        options["offset"] = offsetAndLimit?.offset ?? 0;

        if (options.offset > 0) {
            options.offset = Math.max(0, Math.min(options.offset, totalCount - (limit ? (totalCount % limit) : 0)));
        }

        if (limit) {
            options["limit"] = limit;
        }

        return totalCount;
    }

    public static async loadCache(): Promise<void> {
        return;
    }
}
