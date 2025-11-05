import {Sequelize, DataTypes, FindOptions, Op, OrderItem} from "sequelize";

import {BaseModel, EntityQueryInput, EntityQueryOutput} from "./baseModel";
import {
    optionsIncludeNeuronIds,
    optionsWhereIds,
    WithNeuronsQueryInput
} from "./findOptions";
import {AtlasStructureTableName} from "./tableNames";
import {Atlas} from "./atlas";

export type AtlasStructureQueryInput = EntityQueryInput & WithNeuronsQueryInput;

export type AtlasStructureShape = {
    id: string;
    internalId: number;
    structureId: number;
    depth: number;
    name: string;
    parentStructureId: number;
    structureIdPath: string;
    safeName: string;
    acronym: string;
    aliases: string[];
    defaultColor: string;
    hasGeometry: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export class AtlasStructure extends BaseModel {
    public structureId: number;
    public depth: number;
    public name: string;
    public parentStructureId: number;
    public structureIdPath: string;
    public safeName: string;
    public acronym: string;
    public internalId: number;
    public aliases: string[];
    public defaultColor: string;
    public hasGeometry: number;

    public static async getAll(input: AtlasStructureQueryInput): Promise<EntityQueryOutput<AtlasStructure>> {
        let options: FindOptions = optionsWhereIds(input);

        options = optionsIncludeNeuronIds(input, options);

        const count = await this.setSortAndLimiting(options, input);

        const areas = await AtlasStructure.findAll(options);

        return {totalCount: count, items: areas};
    }

    public static async findId(id: string): Promise<string> {
        return AtlasStructure.findIdWithValidationInternal(AtlasStructure, id);
    }

    public static async findIdWithAnyNameOrAcronym(name: string): Promise<string> {
        return (await AtlasStructure.findOne({
            where: {
                [Op.or]: {
                    name: name,
                    safeName: name,
                    acronym: name
                }
            }
        }))?.id;
    }

    protected static override defaultSort(): OrderItem[] {
        return [["depth", "DESC"]];
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return AtlasStructure.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        internalId: DataTypes.INTEGER,
        structureId: DataTypes.INTEGER,
        parentStructureId: DataTypes.INTEGER,
        name: DataTypes.TEXT,
        safeName: DataTypes.TEXT,
        acronym: DataTypes.TEXT,
        aliases:  {
            type: DataTypes.JSONB,
            defaultValue: []
        },
        structureIdPath: DataTypes.TEXT,
        depth: DataTypes.INTEGER,
        defaultColor: DataTypes.TEXT,
        hasGeometry: DataTypes.BOOLEAN
    }, {
        tableName: AtlasStructureTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    AtlasStructure.belongsTo(Atlas, {foreignKey: "atlasId"});
};
