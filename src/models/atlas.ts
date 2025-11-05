import {BaseModel} from "./baseModel";
import {DataTypes, Op, Sequelize, Transaction} from "sequelize";
import {AtlasTableName} from "./tableNames";
import {AtlasStructure} from "./atlasStructure";
import {AtlasKind} from "./atlasKind";
import {User} from "./user";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {isNullOrEmpty} from "../util/objectUtil";
import {NrrdFile} from "../io/nrrdFile";

const debug = require("debug")("nmcp:nmcp-api:atlas");

export type AtlasLocation = {
    x: number;
    y: number;
    z: number;
}

export type AtlasShape = {
    name?: string;
    description?: string;
    reference?: string;
    spatialUrl?: string;
    geometryUrl?: string;
    rootStructureId?: number;
    atlasKindId?: string;
}

export class Atlas extends BaseModel {
    public name: string;
    public description: string;
    public reference: string;
    public spatialUrl?: string;
    public geometryUrl: string;
    public rootStructureId: number;
    public atlasKindId: string;

    public readonly AtlasKind?: AtlasKind;

    public static defaultAtlas: Atlas = null;

    private static readonly _atlasMap = new Map<string, Atlas>();

    // Not currently exposed to anything other than smartsheet import.  Will need similar createOrUpdate... treatment as specimen/neuron/collection/etc.
    public static async createForShape(shape: AtlasShape, user: User, t: Transaction): Promise<Atlas> {
        if (!shape.atlasKindId) {
            throw new Error("atlasKindId is required.")
        }

        if (isNullOrEmpty(shape.name)) {
            throw new Error("Name cannot be empty.");
        }

        const atlas = await this.create(shape, {transaction: t});

        await recordEvent({
            kind: EventLogItemKind.AtlasCreate,
            targetId: atlas.id,
            parentId: shape.atlasKindId,
            details: shape,
            userId: user.id
        }, t);

        return atlas;
    }

    // The atlas structure and all substructures, so that searching the parent is same as searching in all the children.
    private _structureTreeById = new Map<string, string[]>();

    private _structureById = new Map<string, AtlasStructure>();

    private _structureByAcronym = new Map<string, AtlasStructure>();

    private _structureByName = new Map<string, AtlasStructure>();

    private _structureBySafeName = new Map<string, AtlasStructure>();

    private _structureByStructureId = new Map<number, AtlasStructure>();

    private _rootId: string;

    private _spatialLookup: any;

    public matchAnyLabel(str: string, allowSimplify: boolean = false): AtlasStructure {
        let structure = this.getFromAcronym(str);

        if (allowSimplify) {
            str = str.replace(new RegExp(",", 'g'), "");
        }
        if (!structure) {
            structure = this.getFromName(str)
        }

        if (!structure) {
            structure = this.getFromSafeName(str)
        }

        return structure;
    }

    public getFromAcronym(acronym: string): AtlasStructure {
        return this._structureByAcronym.get(acronym.toLowerCase()) ?? null;
    }

    public getFromName(name: string): AtlasStructure {
        return this._structureByName.get(name.toLowerCase()) ?? null;
    }

    public getFromSafeName(name: string): AtlasStructure {
        return this._structureBySafeName.get(name.toLowerCase()) ?? null;
    }

    public getFromStructureId(id: number): AtlasStructure {
        return this._structureByStructureId.get(id) ?? null;
    }

    public getComprehensiveBrainArea(id: string): string[] {
        return this._structureTreeById.get(id) ?? null;
    }

    public wholeBrainId(): string {
        return this._rootId;
    }

    public findForLocation(location: AtlasLocation, useFallback: boolean) {
        if (location.x < 0 || location.y < 0 || location.z < 0) {
            return null;
        }

        const fallback = useFallback ? this._rootId : null;

        const transformedLocation = [Math.ceil(location.x / 10), Math.ceil(location.y / 10), Math.ceil(location.z / 10)];

        const structureId = this._spatialLookup.findStructureId(transformedLocation[0], transformedLocation[1], transformedLocation[2]);

        return this.getFromStructureId(structureId)?.id ?? fallback;
    }

    private async loadCompartmentCache() {
        if (this._structureTreeById.size > 0) {
            return
        }

        const start = performance.now();

        const structures = await AtlasStructure.findAll({where: {atlasId: this.id}});

        debug(`caching ${structures.length} ${this.name} atlas structures`);

        for (let idx = 0; idx < structures.length; idx++) {
            const b = structures[idx];

            this._structureById.set(b.id, b);

            this._structureByName.set(b.name.toLowerCase(), b);
            this._structureByAcronym.set(b.acronym.toLowerCase(), b);
            this._structureBySafeName.set(b.safeName.toLowerCase(), b);

            this._structureByStructureId.set(b.structureId, b);

            const result = await AtlasStructure.findAll({
                attributes: ["id", "structureIdPath"],
                where: {structureIdPath: {[Op.like]: b.structureIdPath + "%"}}
            });

            this._structureTreeById.set(b.id, result.map(r => r.id));
        }

        if (this.rootStructureId != null) {
            const wholeBrain = this._structureByStructureId.get(this.rootStructureId);

            this._rootId = wholeBrain.id;
        }

        if (this.spatialUrl) {
            try {
                this._spatialLookup = new NrrdFile(this.spatialUrl);

                this._spatialLookup.init();

                debug(`${this.name} spatial location extents ${this._spatialLookup.size[0]} ${this._spatialLookup.size[1]} ${this._spatialLookup.size[2]}`);
            } catch (error) {
                debug(error);
            }
        }

        const duration = performance.now() - start;

        debug(`loaded atlas ${this.name} in ${(duration/1000).toFixed(1)}s`);
    }

    public static getAtlas(id: string) {
        return this._atlasMap.get(id);
    }

    public static async loadCache() {
        const atlases = await this.findAll();

        // TODO Atlas get rid of defaultAtlas when there is more than one Atlas and caller referencing the property have been updated to use per-specimen atlas.
        this.defaultAtlas = atlases[0]; // At least one atlas is required.  Let this blow up if not.

        for (const atlas of atlases) {
            await atlas.loadCompartmentCache();
            this._atlasMap.set(atlas.id, atlas);
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Atlas.init({
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
        },
        spatialUrl: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        geometryUrl: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        rootStructureId: {
            type: DataTypes.INTEGER,
            defaultValue: null
        },
    }, {
        tableName: AtlasTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Atlas.belongsTo(AtlasKind, {foreignKey: "atlasKindId"});
    Atlas.hasMany(AtlasStructure, {foreignKey: "atlasId"});
};
