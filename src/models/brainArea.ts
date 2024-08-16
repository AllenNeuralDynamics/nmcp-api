import {Sequelize, DataTypes, HasManyGetAssociationsMixin, FindOptions, Op} from "sequelize";

import {BaseModel, EntityMutateOutput, EntityQueryInput, EntityQueryOutput} from "./baseModel";
import {Neuron} from "./neuron";
import {
    optionsIncludeNeuronIds,
    optionsWhereIds,
    WithNeuronsQueryInput
} from "./findOptions";

const debug = require("debug")("mnb:nmcp-api:brain-structure");

// As defined by Allen Atlas
const WHOLE_BRAIN_STRUCTURE_ID = 997;

export type CompartmentQueryInput = EntityQueryInput & WithNeuronsQueryInput;

export interface IBrainArea {
    id: string;
    structureId: number;
    depth: number;
    name: string;
    parentStructureId: number;
    structureIdPath: string;
    safeName: string;
    acronym: string;
    atlasId: number;
    graphId: number;
    graphOrder: number;
    hemisphereId: number;
    geometryFile: string;
    geometryColor: string;
    geometryEnable: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export class BrainArea extends BaseModel {
    public structureId: number;
    public depth: number;
    public name: string;
    public parentStructureId: number;
    public structureIdPath: string;
    public safeName: string;
    public acronym: string;
    public atlasId: number;
    public aliases: string;
    public graphId: number;
    public graphOrder: number;
    public hemisphereId: number;
    public geometryFile: string;
    public geometryColor: string;
    public geometryEnable: boolean;

    public aliasList: string[];

    public getNeurons!: HasManyGetAssociationsMixin<Neuron>;

    // The area and all subareas, so that searching the parent is same as searching in all the children.
    private static _comprehensiveBrainAreaLookup = new Map<string, string[]>();

    private static _brainAreaCache = new Map<string, BrainArea>();

    private static _wholeBrainId: string;

    public static getOne(id: string) {
        return this._brainAreaCache.get(id);
    }

    public static wholeBrainId(): string {
        return this._wholeBrainId;
    }

    public static getComprehensiveBrainArea(id: string): string[] {
        return this._comprehensiveBrainAreaLookup.get(id);
    }

    public static async loadCompartmentCache() {
        const brainAreas = await BrainArea.findAll({});

        debug(`caching ${brainAreas.length} brain areas`);

        for (let idx = 0; idx < brainAreas.length; idx++) {
            const b = brainAreas[idx];

            this._brainAreaCache.set(b.id, b);

            const result = await BrainArea.findAll({
                attributes: ["id", "structureIdPath"],
                where: {structureIdPath: {[Op.like]: b.structureIdPath + "%"}}
            });

            this._comprehensiveBrainAreaLookup.set(b.id, result.map(r => r.id));
        }

        const wholeBrain = await BrainArea.findOne({where: {structureId: WHOLE_BRAIN_STRUCTURE_ID}});

        this._wholeBrainId = wholeBrain.id;
    }

    public static async getAll(input: CompartmentQueryInput): Promise<EntityQueryOutput<BrainArea>> {
        let options: FindOptions = optionsWhereIds(input);

        options = optionsIncludeNeuronIds(input, options);

        const count = await this.setSortAndLimiting(options, input);

        const areas = await BrainArea.findAll(options);

        return {totalCount: count, items: areas};
    }

    public static async findId(id: string): Promise<string> {
        return BrainArea.findIdWithValidationInternal(BrainArea, id);
    }

    public static async findIdWithAnyNameOrAcronym(name: string): Promise<string> {
        return (await BrainArea.findOne({
            where: {
                [Op.or]: {
                    name: name,
                    safeName: name,
                    acronym: name
                }
            }
        }))?.id;
    }

    protected static defaultSortField(): string {
        return "depth";
    }
}

export const modelInit = (sequelize: Sequelize) => {
    BrainArea.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        structureId: DataTypes.INTEGER,
        depth: DataTypes.INTEGER,
        name: DataTypes.TEXT,
        parentStructureId: DataTypes.INTEGER,
        structureIdPath: DataTypes.TEXT,
        safeName: DataTypes.TEXT,
        acronym: DataTypes.TEXT,
        aliases: DataTypes.TEXT,
        atlasId: DataTypes.INTEGER,
        graphId: DataTypes.INTEGER,
        graphOrder: DataTypes.INTEGER,
        hemisphereId: DataTypes.INTEGER,
        geometryFile: DataTypes.TEXT,
        geometryColor: DataTypes.TEXT,
        geometryEnable: DataTypes.BOOLEAN,
        aliasList: {
            type: DataTypes.VIRTUAL(DataTypes.ARRAY(DataTypes.STRING), ["aliases"]),
            get: function (): string[] {
                return JSON.parse(this.getDataValue("aliases")) || [];
            },
            set: function (value: string[]) {
                if (value && value.length === 0) {
                    value = null;
                }

                this.setDataValue("aliases", JSON.stringify(value));
            }
        }
    }, {
        tableName: "BrainStructure",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    BrainArea.hasMany(Neuron, {foreignKey: "brainStructureId"});
};
