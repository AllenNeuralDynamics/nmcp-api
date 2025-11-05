import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, OrderItem, Sequelize} from "sequelize";

import {
    BaseModel,
    EntityQueryInput,
    EntityQueryOutput,
} from "./baseModel";
import {
    optionsWhereIds,
    optionsWhereGenotypeIds,
    WithGenotypeQueryInput
} from "./findOptions";
import {Genotype} from "./genotype";
import {Neuron} from "./neuron";
import {Injection} from "./injection";
import {Collection} from "./collection";
import {AtlasTableName, SpecimenTableName} from "./tableNames";
import {User} from "./user";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {Atlas} from "./atlas";
import {PortalJsonSpecimen} from "../io/portalJson";
import moment = require("moment");

const debug = require("debug")("nmcp:nmcp-api:specimen-model");

type SpecimenSomaProperties = {
    defaultBrightness: number;
    defaultVolume: number;
}

export type SpecimenQueryArgs =
    EntityQueryInput
    & WithGenotypeQueryInput;

export type SpecimenShape = {
    id?: string,
    label?: string;
    referenceDate?: Date;
    notes?: string;
    keywords?: string[];
    genotypeId?: string;
    genotypeName?: string;
    tomographyUrl?: string;
    somaProperties?: SpecimenSomaProperties;
    atlasId?: string;
    collectionId?: string;
}

export type SpecimenCreateOrUpdateOptions = {
    allowCreate?: boolean;
    allowMatchLabel?: boolean;
    substituteUser?: User;
}

export class Specimen extends BaseModel {
    public label: string;
    public referenceDate: Date;
    public notes: string;
    public keywords?: string[];
    public tomographyUrl: string;
    public somaProperties?: SpecimenSomaProperties;
    public collectionId?: string;
    public atlasId?: string;

    public getCollection!: BelongsToGetAssociationMixin<Collection>;
    public getGenotype!: BelongsToGetAssociationMixin<Genotype>;
    public getInjections!: HasManyGetAssociationsMixin<Injection>;
    public getNeurons!: HasManyGetAssociationsMixin<Neuron>;

    public readonly Collection?: Collection;
    public readonly Genotype?: Genotype;
    public readonly Injections?: Injection[];
    public readonly Neurons?: Neuron[];

    public static async getAll(input: SpecimenQueryArgs): Promise<EntityQueryOutput<Specimen>> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsWhereGenotypeIds(input, options);

        const count = await this.setSortAndLimiting(options, input);

        const specimens = await Specimen.findAll(options);

        return {totalCount: count, items: specimens};
    }

    private static async createForShape(user: User, shape: SpecimenShape, substituteUser: User): Promise<Specimen> {
        if (shape === undefined || shape === null) {
            throw new Error("Specimen properties are required.");
        }

        if (!shape.collectionId) {
            throw new Error("A collection is required to create a specimen.")
        }

        shape.label ??= "";
        shape.notes ??= "";
        shape.tomographyUrl ??= "";
        // TODO Atlas Should not use a default until officially supporting multiple atlases.
        shape.atlasId ??= Atlas.defaultAtlas.id;


        return await Specimen.sequelize.transaction(async (t) => {
            const specimen = await Specimen.create(shape, {transaction: t});

            // Explicit id takes precedence.
            if (!shape.genotypeId && shape.genotypeName?.trim()) {
                if (shape.genotypeName) {
                    const genotype = await Genotype.findOrCreateFromName(user, shape.genotypeName, specimen.id, substituteUser, t);
                    await specimen.update({genotypeId: genotype.id});
                }
            }

            await recordEvent({
                kind: EventLogItemKind.SpecimenCreate,
                targetId: specimen.id,
                parentId: specimen.collectionId,
                userId: user.id,
                details: shape,
                substituteUserId: substituteUser?.id
            }, t);

            return specimen
        });
    }

    private async updateForShape(user: User, shape: SpecimenShape, substituteUser: User): Promise<Specimen> {
        // Ok to be undefined (and not updated) - not ok to be null.
        if (shape.label === null) {
            shape.label = "";
        }

        if (shape.notes === null) {
            shape.notes = "";
        }

        if (shape.tomographyUrl === null) {
            shape.tomographyUrl = "";
        }

        if (shape.collectionId === null) {
            delete shape.collectionId;
        }

        return await Specimen.sequelize.transaction(async (t) => {
            if (shape.genotypeName) {
                const out = await Genotype.findOrCreateFromName(user, shape.genotypeName, this.id, substituteUser, t);

                shape.genotypeId = out.id;
            } else if (shape.genotypeName === null) {
                // Ok to be null, shouldn't change anything if undefined.
                shape.genotypeId = null;
            }

            const specimen = await this.update(shape, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.SpecimenUpdate,
                targetId: specimen.id,
                parentId: specimen.collectionId,
                userId: user.id,
                details: shape,
                substituteUserId: substituteUser?.id
            }, t);

            return specimen;
        });
    }

    public static async createOrUpdateForShape(shape: SpecimenShape, user: User, options: SpecimenCreateOrUpdateOptions = defaultCreateOrUpdateOptions): Promise<Specimen> {
        if (!options.substituteUser?.canEditSpecimens() && !user?.canEditSpecimens()) {
            throw new UnauthorizedError();
        }

        let specimen: Specimen;

        if (shape.id) {
            specimen = await Specimen.findByPk(shape.id);
        }

        if (!specimen && options.allowMatchLabel) {
            specimen = await Specimen.findOne({where: {label: shape.label}});
        }

        if (!specimen) {
            if (options.allowCreate) {
                return this.createForShape(user, shape, options.substituteUser);
            }
            return null;
        }

        return specimen.updateForShape(user, shape, options.substituteUser);
    }

    public static async deleteByPk(id: string, user: User): Promise<string> {
        if (!user?.canEditSpecimens()) {
            throw new UnauthorizedError();
        }

        if (!id || id.length === 0) {
            throw new Error("Specimen id is a required argument");
        }

        return await Specimen.sequelize.transaction(async (t) => {
            const specimen = await Specimen.findByPk(id, {attributes: ["id", "collectionId"]});
            const count = await Specimen.destroy({where: {id}, transaction: t});

            if (count > 0) {
                await recordEvent({
                    kind: EventLogItemKind.SpecimenDelete,
                    parentId: specimen.collectionId,
                    targetId: id,
                    userId: user.id
                }, t);

                return id;
            }

            await t.rollback();

            throw new Error(`The specimen could not be removed.  Verify ${id} is a valid specimen id.`);
        });
    }

    public async neuronCount(): Promise<number> {
        return await Neuron.count({where: {specimenId: this.id}});
    }

    // Not utilizing the Sequelize auto-generated relationship because Atlas instances are cached with their spatial and other lookups loaded.
    public getAtlas(): Atlas {
        return Atlas.getAtlas(this.atlasId);
    }

    protected static override defaultSort(): OrderItem[] {
        return [["label", "ASC"]];
    }

    public toPortalJson(): PortalJsonSpecimen {
        // Assumes/requires relationships have been eager-loaded.
        return {
            date: this.referenceDate ? moment(this.referenceDate).format() : "",
            subject: this.label,
            genotype: this.Genotype?.name ?? "",
            collection: this.Collection?.toPortalJson() ?? null
        };
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Specimen.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        label: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        referenceDate: DataTypes.DATE,
        keywords: {
            type: DataTypes.JSONB,
            defaultValue: []
        },
        notes: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        somaProperties: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        tomographyUrl: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        atlasId: {
            // Would generally be in modelAssociate below, but using a custom getAtlas() method for cached lookups.
            type: DataTypes.UUID,
            references: {
                model: AtlasTableName,
                key: "id"
            },
            allowNull: false
        }
    }, {
        tableName: SpecimenTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Specimen.belongsTo(Genotype, {foreignKey: "genotypeId"});
    Specimen.belongsTo(Collection, {foreignKey: "collectionId"});
    Specimen.belongsTo(Atlas, {foreignKey: "atlasId"});
    Specimen.hasMany(Neuron, {foreignKey: "specimenId"});
    Specimen.hasMany(Injection, {foreignKey: "specimenId"});
};

const defaultCreateOrUpdateOptions: SpecimenCreateOrUpdateOptions = {
    allowCreate: false,
    allowMatchLabel: false,
    substituteUser: null
}
