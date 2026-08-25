import {
    BelongsToGetAssociationMixin,
    DataTypes,
    FindOptions,
    HasManyGetAssociationsMixin,
    Includeable,
    IncludeOptions,
    literal,
    Op,
    Sequelize,
    Transaction
} from "sequelize";
import "fs";
import * as _ from "lodash";

import {NeuronTableName} from "./tableNames";
import {BaseModel, EntityQueryInput, EntityQueryOutput} from "./baseModel";
import {
    optionsWhereAtlasStructureIds,
    optionsWhereIds,
    optionsWhereSpecimenIds,
    WithAtlasStructureQueryInput,
    WithSpecimensQueryInput
} from "./findOptions";
import {AtlasStructure} from "./atlasStructure";
import {Specimen} from "./specimen";
import {SearchContext} from "./searchContext";
import {SearchIndex, FilterQueryResult} from "./searchIndex";
import {PredicateType} from "./queryPredicate";
import {recordSearchMetrics} from "../data-access/searchMetrics/searchMetricsService";
import {SearchQueryMetrics, SearchPredicateMetrics} from "../data-access/searchMetrics/searchMetricsTypes";
import {AtlasReconstruction} from "./atlasReconstruction";
import {User} from "./user";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {normalizeKeywords, substringMatchPatterns} from "../util/keywords";
import {Genotype} from "./genotype";
import {isNullOrEmpty} from "../util/objectUtil";
import {Reconstruction} from "./reconstruction";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {Collection} from "./collection";
import {DataCiteService, DataCiteServiceStatus, DataCiteRelatedIdentifier} from "../data-access/doi/dataCiteService";
import {CoreServiceOptions} from "../options/coreServicesOptions";
import {Atlas} from "./atlas";
import {ReconstructionStatus} from "./reconstructionStatus";
import {publishedCount} from "./systemSettings";
import {PortalNeuron} from "../io/portalFormat";

const debug = require("debug")("nmcp:nmcp-api:neuron-model");

export type SomaLocation = {
    x: number;
    y: number;
    z: number;
}

export type SomaFilterInput = {
    limitBrightness: boolean;
    brightnessRange: number[];
    limitVolume: boolean;
    volumeRange: number[];
}

export type SomaProperties = {
    brightness?: number;
    volume?: number;
    radii?: SomaLocation;
}

export type SomaImportResponse = {
    count: number;
    error: Error;
}

export enum NeuronStatusFilter {
    Unpublished = 100,
    Published = 200,
}

export type NeuronQueryInput =
    EntityQueryInput
    & WithSpecimensQueryInput
    & WithAtlasStructureQueryInput
    & {
    keywords?: string[];
    genotype?: string[];
    somaProperties?: SomaFilterInput;
    status: NeuronStatusFilter;
};

export type NeuronShape = {
    id?: string;
    label?: string;
    keywords?: string[];
    specimenSoma: SomaLocation;
    atlasSoma: SomaLocation;
    somaProperties?: SomaProperties;
    atlasStructureId?: string;
    specimenId?: string;
}

export type NeuronBulkUpdateShape = {
    keywords?: string[];
    atlasStructureId?: string;
}

export type NeuronCreateOrUpdateOptions = {
    allowCreate?: boolean;
    allowMatchLabel?: boolean;
    substituteUser?: User;
}

export type SearchOutputPage = {
    nonce: string;
    queryTime: number;
    totalCount: number;
    neurons: Neuron[];
    error: Error;
}

export class Neuron extends BaseModel {
    public label: string;
    public keywords: string[];
    public specimenSoma: SomaLocation;
    public atlasSoma: SomaLocation
    public somaProperties?: SomaProperties;
    public canonicalDoi: string;
    public specimenId: string;
    public atlasStructureId?: string;

    public getSpecimen!: BelongsToGetAssociationMixin<Specimen>;
    public getAtlasStructure!: BelongsToGetAssociationMixin<AtlasStructure>;
    public getSpecimenReconstruction!: HasManyGetAssociationsMixin<Reconstruction>;

    public AtlasStructure: AtlasStructure;
    public Specimen?: Specimen;

    private async recordEvent(kind: EventLogItemKind, details: NeuronShape, user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.specimenId,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, t);
    }

    public static async publishedCount(): Promise<number> {
        return await Reconstruction.count({where: {status: ReconstructionStatus.Published}, distinct: true, col: "neuronId"});
    }

    /**
     * The parent specimen include, filtered on genotype when requested.  Deliberately a case-insensitive
     * substring match so that partial entry works, consistent with keyword filtering.
     */
    private static specimenInclude(input: NeuronQueryInput, attributes: string[] = null): IncludeOptions {
        const include: IncludeOptions = {model: Specimen, as: "Specimen"};

        if (attributes) {
            include.attributes = attributes;
        }

        const patterns = substringMatchPatterns(input?.genotype);

        if (patterns.length > 0) {
            // Inner joins so that a neuron whose specimen has no matching genotype drops out rather than
            // coming back with a null association.
            include.required = true;
            include.include = [{
                model: Genotype,
                attributes: [],
                required: true,
                where: {name: {[Op.iLike]: {[Op.any]: patterns}}}
            }];
        }

        return include;
    }

    private static applyNeuronFilters(options: FindOptions, input: NeuronQueryInput): void {
        // Deliberately a substring match so that partial entry works.
        const patterns = substringMatchPatterns(input?.keywords);

        if (!options) {
            options = {};
        }

        if (patterns.length > 0) {
            if (!options.where) {
                options.where = {};
            }

            options.where["keywords"] = literal(`EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text("Neuron"."keywords") AS elem
            WHERE elem ILIKE ANY(ARRAY[:neuronKeywords])
          )`);

            options["replacements"] = {...(options["replacements"] ?? {}), neuronKeywords: patterns};
        }

        if (input?.somaProperties) {
            if (!options.where) {
                options.where = {};
            }
            if (input.somaProperties.limitBrightness && input.somaProperties.brightnessRange?.length > 1) {
                options.where["somaProperties"] = {
                    brightness: {[Op.between]: input.somaProperties.brightnessRange.slice(0, 2)}
                };
            }

            if (input.somaProperties.limitVolume && input.somaProperties.volumeRange?.length > 1) {
                if (!options.where["somaProperties"]) {
                    options.where["somaProperties"] = {};
                }
                options.where["somaProperties"]["volume"] = {[Op.between]: input.somaProperties.volumeRange.slice(0, 2)};
            }
        }

        if (input?.status) {
            if (!options.include) {
                options.include = [];
            }

            if (input.status == NeuronStatusFilter.Published) {
                (options.include as Includeable[]).push({
                    model: Reconstruction,
                    as: "SpecimenReconstruction",
                    where: {status: ReconstructionStatus.Published},
                    attributes: [],
                    required: true
                });
            } else if (input.status == NeuronStatusFilter.Unpublished) {
                (options.include as Includeable[]).push({
                    model: Reconstruction,
                    as: "SpecimenReconstruction",
                    where: {
                        status: {
                            [Op.ne]: ReconstructionStatus.Published
                        }
                    },
                    attributes: [],
                    required: true
                });
            }
        }
    }

    public static async getAll(user: User, input: NeuronQueryInput): Promise<EntityQueryOutput<Neuron>> {
        if (!user?.canViewData()) {
            throw new UnauthorizedError();
        }

        const options = this.constructFindOptions(input);

        const count = await this.setSortAndLimiting(options, input);

        options.order = [[{model: Specimen, as: "Specimen"}, "label", "ASC"], ["label", "ASC"]];

        const neurons = await Neuron.findAll(options);

        return {totalCount: count, items: neurons};
    }

    public static async getCandidateNeurons(input: NeuronQueryInput, includeInProgress: boolean = false): Promise<EntityQueryOutput<Neuron>> {
        const neuronIds = (await Neuron.findAll({attributes: ["id"]})).map(n => n.id);

        // TODO TODO Needs to filter out discarded and archived also
        const reconstructionWhere = includeInProgress ? {status: ReconstructionStatus.Published} : null;

        const neuronIdsWithCompletedReconstruction = (await Reconstruction.findAll({
            where: reconstructionWhere,
            attributes: ["id", "neuronId"]
        })).map(t => t.neuronId);

        const neuronsWithCompletedReconstruction = _.uniq(neuronIdsWithCompletedReconstruction);

        const candidateNeuronIds = _.difference(neuronIds, neuronsWithCompletedReconstruction);

        let options: FindOptions = {where: {id: {[Op.in]: candidateNeuronIds}}, include: [], offset: 0};

        this.applyNeuronFilters(options, input);

        // TODO Atlas for multiple atlases to be supported, input.atlasStructureIds will have to have been selected from a specific atlas, which will need
        //  to have been added to the input args, and will be used for this step instead of hard-coded defaultAtlas.
        options = optionsWhereAtlasStructureIds(input, Atlas.defaultAtlas, options);

        (options.include as Includeable[]).push(this.specimenInclude(input, ["id", "label"]));

        if (input.specimenIds && input.specimenIds.length > 0) {
            options.where["$Specimen.id$"] = {[Op.in]: input.specimenIds}
        }

        const totalCount = await this.setSortAndLimiting(options, input);

        options["order"] = [["Specimen", "label", "ASC"], ["label", "ASC"]];

        const candidateNeurons = await Neuron.findAll(options);

        return {totalCount, offset: options.offset ?? 0, items: candidateNeurons};
    }

    private static async isDuplicate(label: string, specimenId: string, id: string = null): Promise<boolean> {
        if (!specimenId || !label) {
            return false;
        }

        const specimen = await Specimen.findByPk(specimenId);

        if (!specimen) {
            return false;
        }

        // All neurons for specimen that have the same label
        const dupes = await Neuron.findAll({where: {specimenId: {[Op.eq]: specimenId}, label: label}});

        return dupes.length > 0 && (!id || (id !== dupes[0].id));
    }

    private static async isDuplicateNeuronObj(neuron: NeuronShape): Promise<boolean> {
        return Neuron.isDuplicate(neuron.label, neuron.specimenId, neuron.id);
    }

    private static async createWithTransaction(shape: NeuronShape, user: User, t: Transaction, substituteUser: User = null) {
        // Assumes a validated input shape.
        const neuron = await this.create(shape, {transaction: t});

        await neuron.recordEvent(EventLogItemKind.NeuronCreate, shape, user, t, substituteUser);

        return neuron;
    }

    private static async createForShape(inputShape: NeuronShape, user: User, substituteUser: User): Promise<Neuron> {
        const specimen = await Specimen.findByPk(inputShape.specimenId);

        if (!specimen) {
            throw new Error("The requested specimen can not be found.");
        }

        if (inputShape.atlasStructureId) {
            const atlasStructure = await AtlasStructure.findByPk(inputShape.atlasStructureId);
            if (!atlasStructure) {
                throw new Error("The requested atlas structure can not be found.");
            }
        } else if (inputShape.atlasStructureId !== null) {
            // Zero-length string or undefined
            inputShape.atlasStructureId = null;
        }

        if (await Neuron.isDuplicateNeuronObj(inputShape)) {
            throw new Error(`a neuron id "${inputShape.label}" already exists on this specimen.`);
        }

        const shape: NeuronShape = {
            label: (inputShape.label ?? "").trim(),
            keywords: normalizeKeywords(inputShape.keywords),
            specimenSoma: inputShape.specimenSoma ?? {x: 0, y: 0, z: 0},
            atlasSoma: inputShape.atlasSoma ?? {x: 0, y: 0, z: 0},
            atlasStructureId: inputShape.atlasStructureId,
            specimenId: inputShape.specimenId
        };

        return this.sequelize.transaction(async (t) => {
            return await this.createWithTransaction(shape, user, t, substituteUser);
        });
    }

    private async updateForShape(shape: NeuronShape, user: User, substituteUser: User): Promise<Neuron> {
        // Undefined is ok (no update) - null, or empty is not - unless it is already that way from create
        if (isNullOrEmpty(shape.label) && this.label) {
            throw new Error("The label cannot be empty");
        } else if (shape.label !== undefined) {
            shape.label = shape.label.trim();
        }

        if (isNullOrEmpty(shape.specimenId)) {
            throw new Error("The specimen id cannot be empty");
        }

        // Null is ok (inherited),  Undefined is ok (no change).  Id of length zero treated as null.  Otherwise, must
        // find a valid atlas structure.
        if (shape.atlasStructureId) {
            const atlasStructure = await AtlasStructure.findByPk(shape.atlasStructureId);

            if (!atlasStructure) {
                throw new Error("The atlas structure cannot be found");
            }
        } else if (shape.atlasStructureId !== undefined && shape.atlasStructureId !== null) {
            // Zero-length string
            shape.atlasStructureId = null;
        }

        // Undefined is ok (no update) - but prefer not null
        if (shape.keywords !== undefined) {
            shape.keywords = normalizeKeywords(shape.keywords);
        }

        if (shape.specimenSoma === null) {
            shape.specimenSoma = {x: 0, y: 0, z: 0};
        }

        if (shape.atlasSoma === null) {
            shape.atlasSoma = {x: 0, y: 0, z: 0};
        }

        return await Neuron.sequelize.transaction(async (t) => {
            const neuron = await this.update(shape, {transaction: t});

            await neuron.recordEvent(EventLogItemKind.NeuronUpdate, shape, user, t, substituteUser);

            return neuron;
        });
    }

    public static async createOrUpdateForShape(shape: NeuronShape, user: User, options: NeuronCreateOrUpdateOptions = defaultCreateOrUpdateOptions): Promise<Neuron> {
        if (!options.substituteUser?.canEditSpecimens() && !user?.canEditNeurons()) {
            throw new UnauthorizedError();
        }

        let neuron: Neuron;

        if (shape.id) {
            neuron = await Neuron.findByPk(shape.id);
        }

        if (!neuron && options.allowMatchLabel) {
            neuron = await Neuron.findOne({where: {label: shape.label, specimenId: shape.specimenId}});
        }

        if (!neuron) {
            if (options.allowCreate) {
                return this.createForShape(shape, user, options.substituteUser);
            }
            return null;
        }

        return neuron.updateForShape(shape, user, options.substituteUser);
    }

    public static async deleteByPk(id: string, user: User): Promise<string> {
        if (!user?.canEditNeurons()) {
            throw new UnauthorizedError();
        }

        if (!id || id.length === 0) {
            throw new Error("Neuron id is a required argument");
        }

        return await Neuron.sequelize.transaction(async (t) => {
            const neuron = await Neuron.findByPk(id, {attributes: ["id", "specimenId"]});
            const count = await Neuron.destroy({where: {id}, transaction: t});

            if (count > 0) {
                await neuron.recordEvent(EventLogItemKind.NeuronUpdate, null, user, t);

                return id;
            }

            await t.rollback();

            throw new Error(`The neuron could not be removed.  Verify ${id} is a valid neuron id.`);
        });
    }

    public static async startReconstruction(user: User, neuronId: string): Promise<Reconstruction> {
        if (!user?.canAnnotate()) {
            throw new UnauthorizedError();
        }

        const [reconstruction, _] = await Reconstruction.openReconstruction(neuronId, user);

        return reconstruction;
    }

    public static async findNextAvailableLabel(specimen: string): Promise<number> {
        const existingNeurons = await Neuron.findAll({
            where: {specimenId: specimen},
            attributes: ["label"],
            order: [["label", "DESC"]]
        });

        let nextNumber = 1;

        if (existingNeurons.length > 0) {
            const existingNumbers = existingNeurons
                .map(n => n.label)
                .filter(label => /^N\d{3,}$/.test(label))
                .map(idString => parseInt(idString.substring(1)))
                .filter(num => !isNaN(num));

            if (existingNumbers.length > 0) {
                nextNumber = Math.max(...existingNumbers) + 1;
            }
        }

        return nextNumber;
    }

    public static async insertSomaEntries(user: User, shapes: NeuronShape[], labelBase: number, t: Transaction): Promise<number> {
        let nextNumber = 0;

        try {
            for (const shape of shapes) {
                shape.label = `N${String(labelBase + nextNumber++).padStart(3, "0")}`;
                shape.keywords = normalizeKeywords(shape.keywords);

                if (t) {
                    await this.createWithTransaction(shape, user, t);
                }
            }
        } catch (error) {
            debug(`Error inserting soma entries: ${error.message}`);
            throw {name: "ImportSomasError", message: error.message};
        }

        return shapes.length;
    }

    private static postSearchMetrics(context: SearchContext, filterResult: FilterQueryResult, totalDurationMs: number, resultCount: number, error: string | null): void {
        const queryMetrics: SearchQueryMetrics = {
            nonce: context.Nonce,
            timestamp: new Date(),
            totalDurationMs,
            predicateCount: context.Predicates.length,
            resultCount,
            collectionIds: context.CollectionIds,
            error,
        };

        const predicateMetrics: SearchPredicateMetrics[] = context.Predicates.map((predicate, idx) => {
            const predicateResult = filterResult.predicateResults[idx];
            const parameters: Record<string, unknown> = {};

            if (predicate.anatomicalPredicate) {
                Object.assign(parameters, predicate.anatomicalPredicate);
            } else if (predicate.customRegionPredicate) {
                Object.assign(parameters, predicate.customRegionPredicate);
            } else if (predicate.idOrDoiPredicate) {
                Object.assign(parameters, predicate.idOrDoiPredicate);
            }

            return {
                ordinal: idx,
                predicateType: predicate.predicateType,
                composition: predicate.composition,
                durationMs: predicateResult.durationMs,
                resultCountRaw: predicateResult.rawNeuronIds.length,
                resultCountAfterComposition: predicateResult.composedNeuronIds.length,
                parameters,
            };
        });

        recordSearchMetrics(queryMetrics, predicateMetrics);
    }

    public static async getNeuronsWithPredicates(context: SearchContext): Promise<SearchOutputPage> {
        try {
            const start = Date.now();

            const filterResult = await SearchIndex.performNeuronsFilterQuery(context);

            let neurons = await this.findAll({where: {id: {[Op.in]: filterResult.neuronIds}}});

            const duration = Date.now() - start;

            const totalCount = await publishedCount();

            neurons = neurons.sort((b, a) => a.label.localeCompare(b.label));

            this.postSearchMetrics(context, filterResult, duration, neurons.length, null);

            return {nonce: context.Nonce, queryTime: duration, totalCount, neurons, error: null};

        } catch (err) {
            debug(err);
            debug(context);

            return {nonce: context.Nonce, queryTime: 1, totalCount: 0, neurons: [], error: err};
        }
    }

    private static validateBulkUpdateShape(shape: NeuronBulkUpdateShape): void {
        if (shape.atlasStructureId !== undefined && shape.atlasStructureId !== null && shape.atlasStructureId.length === 0) {
            shape.atlasStructureId = null;
        }

        if (shape.keywords !== undefined) {
            shape.keywords = normalizeKeywords(shape.keywords);
        }
    }

    private static async applyBulkUpdate(neurons: Neuron[], shape: NeuronBulkUpdateShape, user: User): Promise<Neuron[]> {
        if (!user?.canEditNeurons()) {
            throw new UnauthorizedError();
        }

        this.validateBulkUpdateShape(shape);

        if (shape.atlasStructureId) {
            const atlasStructure = await AtlasStructure.findByPk(shape.atlasStructureId);

            if (!atlasStructure) {
                throw new Error("The atlas structure cannot be found");
            }
        }

        const ids = neurons.map(n => n.id);

        return await Neuron.sequelize.transaction(async (t) => {
            await Neuron.update(shape, {where: {id: {[Op.in]: ids}}, transaction: t});

            for (const neuron of neurons) {
                await recordEvent({
                    kind: EventLogItemKind.NeuronUpdate,
                    targetId: neuron.id,
                    parentId: neuron.specimenId,
                    details: shape as unknown as NeuronShape,
                    userId: user.id
                }, t);
            }

            return await Neuron.findAll({where: {id: {[Op.in]: ids}}, transaction: t});
        });
    }

    public static async updateMany(ids: string[], shape: NeuronBulkUpdateShape, user: User): Promise<Neuron[]> {
        if (!user?.canEditNeurons()) {
            throw new UnauthorizedError();
        }

        const neurons = await Neuron.findAll({where: {id: {[Op.in]: ids}}});

        if (neurons.length !== ids.length) {
            const foundIds = new Set(neurons.map(n => n.id));
            const missingIds = ids.filter(id => !foundIds.has(id));
            throw new Error(`Neurons not found: ${missingIds.join(", ")}`);
        }

        return this.applyBulkUpdate(neurons, shape, user);
    }

    public static async updateManyByQuery(input: NeuronQueryInput, shape: NeuronBulkUpdateShape, user: User): Promise<Neuron[]> {
        if (!user?.canEditNeurons()) {
            throw new UnauthorizedError();
        }

        const options = this.constructFindOptions(input);

        const neurons = await Neuron.findAll(options);

        return this.applyBulkUpdate(neurons, shape, user);
    }

    public async published(): Promise<AtlasReconstruction> {
        const reconstruction = await Reconstruction.findOne({where: {neuronId: this.id, status: ReconstructionStatus.Published}});

        return reconstruction?.getAtlasReconstruction();
    }

    private static constructFindOptions(input: NeuronQueryInput): FindOptions {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: [this.specimenInclude(input)]});

        options = optionsWhereSpecimenIds(input, options);

        // TODO Atlas for multiple atlases to be supported, input.atlasStructureIds will have to have been selected from a specific atlas, which will need
        //  to have been added to the input args, and will be used for this step instead of hard-coded defaultAtlas.
        options = optionsWhereAtlasStructureIds(input, Atlas.defaultAtlas, options);

        this.applyNeuronFilters(options, input);

        return options;
    }

    public async assignCanonicalDoi(user: User, publicationYear: number, relatedIdentifiers: DataCiteRelatedIdentifier[], t: Transaction): Promise<string> {
        if (this.canonicalDoi) {
            return this.canonicalDoi;
        }

        const options = CoreServiceOptions.rest.doiGeneration;

        const specimen = this.Specimen ?? await this.getSpecimen({include: [{model: Collection}], transaction: t});
        const collection = specimen.Collection ?? await specimen.getCollection({transaction: t});

        const doiResult = await DataCiteService.createDoi({
            data: {
                type: "dois",
                attributes: {
                    event: "publish",
                    prefix: options.prefix,
                    creators: [{name: "Neuron Morphology Community Portal"}],
                    titles: [{title: `Neuron ${this.label} in the ${collection?.name ?? "(unspecified)"} collection`}],
                    publisher: "Neuron Morphology Community Portal",
                    publicationYear,
                    types: {resourceTypeGeneral: "Dataset"},
                    url: `${options.url}neuron/${this.id}`,
                    subjects: [{subject: "Neuron"}],
                    alternateIdentifiers: [{alternateIdentifier: this.label, alternateIdentifierType: "Neuron Label"}],
                    relatedIdentifiers,
                    version: 1,
                    rights: "CC-BY-4.0"
                }
            }
        });

        if (doiResult.serviceStatus !== DataCiteServiceStatus.Success) {
            throw new Error(`Neuron DOI creation failed: ${doiResult.serviceError ?? "unknown error"}`);
        }

        await this.update({canonicalDoi: doiResult.doi}, {transaction: t});

        await recordEvent({
            kind: EventLogItemKind.NeuronAssignDoi,
            targetId: this.id,
            parentId: this.specimenId,
            details: {doi: doiResult.doi},
            userId: user.id
        }, t);

        debug(`canonical doi assigned to neuron ${this.label}: ${doiResult.doi}`);

        return doiResult.doi;
    }

    public toPortalFormat(): PortalNeuron {
        // Assumes/requires relationships have been eager-loaded.
        return {
            id: this.id,
            label: this.label,
            specimen: this.Specimen.toPortalFormat()
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Neuron.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        label: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        keywords: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: []
        },
        specimenSoma: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        atlasSoma: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        somaProperties: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        canonicalDoi: {
            type: DataTypes.TEXT,
            defaultValue: null
        }
    }, {
        tableName: NeuronTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Neuron.belongsTo(Specimen, {foreignKey: "specimenId", as: "Specimen"});
    Neuron.belongsTo(AtlasStructure, {foreignKey: "atlasStructureId",});
    Neuron.hasMany(Reconstruction, {foreignKey: "neuronId", as: "SpecimenReconstruction"});
};

const defaultCreateOrUpdateOptions: NeuronCreateOrUpdateOptions = {
    allowCreate: false,
    allowMatchLabel: false,
    substituteUser: null
}
