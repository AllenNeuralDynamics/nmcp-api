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
import {validate} from "uuid";

import {NeuronTableName, ReconstructionTableName} from "./tableNames";
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
import {isNullOrEmpty, mergeJsonProperties} from "../util/objectUtil";
import {CandidateBlockingStatuses, CandidateExcludedStatuses, PublishedCandidateBlockingStatuses, Reconstruction} from "./reconstruction";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {Collection} from "./collection";
import {DataCiteService, DataCiteServiceStatus, DataCiteRelatedIdentifier} from "../data-access/doi/dataCiteService";
import {CoreServiceOptions} from "../options/coreServicesOptions";
import {Atlas} from "./atlas";
import {ReconstructionStatus} from "./reconstructionStatus";
import {publishedCount} from "./systemSettings";
import {PortalNeuron} from "../io/portalFormat";

const debug = require("debug")("nmcp:nmcp-api:neuron-model");

export const CandidateLocationChunkSize = 2000;

export type CandidateNeuronLocations = {
    ids: string[];
    locations: number[][];
    nextCursor: string | null;
    totalCount: number | null;
}

// A coordinate that failed to parse on import is stored as null (NaN serializes that way), and a single null under
// [[Float!]] would fail the whole chunk, so an incomplete location reports as no location.
function atlasSomaTriple(soma: SomaLocation | null): number[] | null {
    const triple = [soma?.x, soma?.y, soma?.z];

    return triple.every(value => typeof value === "number" && Number.isFinite(value)) ? triple : null;
}

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

export type NeuronMetadata = {
    instance?: number;
    priority?: number;
    somaGroup?: string;
}

export type SomaImportResponse = {
    count: number;
    error: Error;
}

export type CanonicalDoiResult = {
    serviceStatus: DataCiteServiceStatus;
    serviceError: string | null;
    doi: string | null;
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
    metadata?: NeuronMetadata;
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
    public metadata?: NeuronMetadata;
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

    private static candidateFindOptions(input: NeuronQueryInput, includeInProgress: boolean, excludedReconstructionStatuses: ReconstructionStatus[], specimenAttributes: string[] = null): FindOptions {
        const predicates = [literal(`NOT EXISTS (
            SELECT 1
            FROM "${ReconstructionTableName}" AS blocking_reconstruction
            WHERE blocking_reconstruction."neuronId" = "${NeuronTableName}"."id"
              AND blocking_reconstruction."deletedAt" IS NULL
              AND blocking_reconstruction."status" = ANY(ARRAY[:candidateBlockingStatuses])
          )`)];

        // includeInProgress reads backwards: it means only a finished (or in-flight) publication holds the neuron back.
        // Without it, live work holds it back too.
        const replacements: Record<string, unknown> = {
            candidateBlockingStatuses: includeInProgress ? PublishedCandidateBlockingStatuses : CandidateBlockingStatuses
        };

        // Guarded on length because ARRAY[] with an empty replacement is a Postgres type error.
        if (excludedReconstructionStatuses.length > 0) {
            // No deletedAt test: marking a reconstruction untraceable soft-deletes it, and it must still exclude.
            predicates.push(literal(`NOT EXISTS (
            SELECT 1
            FROM "${ReconstructionTableName}" AS excluded_reconstruction
            WHERE excluded_reconstruction."neuronId" = "${NeuronTableName}"."id"
              AND excluded_reconstruction."status" = ANY(ARRAY[:candidateExcludedStatuses])
          )`));

            replacements["candidateExcludedStatuses"] = excludedReconstructionStatuses;
        }

        if (input?.status == NeuronStatusFilter.Published || input?.status == NeuronStatusFilter.Unpublished) {
            // A correlated predicate rather than applyStatusInclude's has-many join, which would repeat a neuron once per
            // matching reconstruction in the location rows and the count.
            const comparison = input.status == NeuronStatusFilter.Published ? "=" : "<>";

            predicates.push(literal(`EXISTS (
            SELECT 1
            FROM "${ReconstructionTableName}" AS status_reconstruction
            WHERE status_reconstruction."neuronId" = "${NeuronTableName}"."id"
              AND status_reconstruction."deletedAt" IS NULL
              AND status_reconstruction."status" ${comparison} :candidatePublishedStatus
          )`));

            replacements["candidatePublishedStatus"] = ReconstructionStatus.Published;
        }

        const options: FindOptions = {where: {[Op.and]: predicates}, include: []};

        options["replacements"] = replacements;

        this.applyNeuronFilters(options, input);

        optionsWhereAtlasStructureIds(input, options);

        (options.include as Includeable[]).push(this.specimenInclude(input, specimenAttributes));

        if (input?.specimenIds?.length > 0) {
            options.where["$Specimen.id$"] = {[Op.in]: input.specimenIds};
        }

        return options;
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
    }

    private static applyStatusInclude(options: FindOptions, input: NeuronQueryInput): void {
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

    public static async getCandidateNeurons(input: NeuronQueryInput, includeInProgress: boolean = false, excludedReconstructionStatuses: ReconstructionStatus[] = CandidateExcludedStatuses): Promise<EntityQueryOutput<Neuron>> {
        const options = this.candidateFindOptions(input, includeInProgress, excludedReconstructionStatuses);

        const offset = Math.max(0, input?.offset ?? 0);

        const pageOptions: FindOptions = {...options, order: [["Specimen", "label", "ASC"], ["label", "ASC"], ["id", "ASC"]], offset};

        if (input?.limit) {
            pageOptions.limit = input.limit;
        }

        const [totalCount, items] = await Promise.all([Neuron.count(options), Neuron.findAll(pageOptions)]);

        return {totalCount, offset, items};
    }

    public static async getCandidateNeuronLocations(input: NeuronQueryInput, includeInProgress: boolean = false, excludedReconstructionStatuses: ReconstructionStatus[] = CandidateExcludedStatuses, after: string = null, chunkSize: number = null): Promise<CandidateNeuronLocations> {
        if (after && !validate(after)) {
            throw new Error("The cursor is not a valid neuron id.");
        }

        const size = chunkSize > 0 ? Math.min(chunkSize, CandidateLocationChunkSize) : CandidateLocationChunkSize;

        const options = this.candidateFindOptions(input, includeInProgress, excludedReconstructionStatuses, []);

        const chunkOptions: FindOptions = {
            ...options,
            where: after ? {...(options.where as object), id: {[Op.gt]: after}} : options.where,
            attributes: ["id", "atlasSoma"],
            order: [["id", "ASC"]],
            limit: size + 1,
            raw: true
        };

        const [totalCount, rows] = await Promise.all([after ? null : Neuron.count(options), Neuron.findAll(chunkOptions)]);

        const chunk = rows.slice(0, size);

        return {
            ids: chunk.map(row => row.id),
            locations: chunk.map(row => atlasSomaTriple(row.atlasSoma)),
            nextCursor: rows.length > size ? chunk[chunk.length - 1].id : null,
            totalCount
        };
    }

    public static async getCandidateNeuronOffset(id: string, input: NeuronQueryInput, includeInProgress: boolean = false, excludedReconstructionStatuses: ReconstructionStatus[] = CandidateExcludedStatuses): Promise<number | null> {
        if (!validate(id)) {
            throw new Error("The id is not a valid neuron id.");
        }

        const options = this.candidateFindOptions(input, includeInProgress, excludedReconstructionStatuses, ["label"]);

        const target: any = await Neuron.findOne({
            ...options,
            where: {...(options.where as object), id},
            attributes: ["id", "label"],
            raw: true,
            nest: true
        });

        if (!target) {
            return null;
        }

        // Mirrors candidateNeurons' ORDER BY for non-null values only.  Labels are assumed set, and deleteByPk and
        // updateForShape keep every candidate's specimen live, so the join never supplies the NULL that NULLS LAST
        // would sort last.
        const before = literal(`("Specimen"."label", "${NeuronTableName}"."label", "${NeuronTableName}"."id") < (:offsetSpecimenLabel, :offsetNeuronLabel, :offsetNeuronId)`);

        const countOptions: FindOptions = {...options, where: {...(options.where as object), [Op.and]: [...(options.where as any)[Op.and], before]}};

        countOptions["replacements"] = {
            ...options["replacements"],
            offsetSpecimenLabel: target.Specimen.label,
            offsetNeuronLabel: target.label,
            offsetNeuronId: target.id
        };

        return Neuron.count(countOptions);
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

    private static assertStructureInAtlas(atlasStructureId: string, atlasId: string): void {
        const atlas = Atlas.getAtlasForStructure(atlasStructureId);

        if (!atlas) {
            throw new Error("The requested atlas structure can not be found.");
        }

        if (atlas.id !== atlasId) {
            throw new Error("The atlas structure does not belong to the specimen's atlas.");
        }
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
            Neuron.assertStructureInAtlas(inputShape.atlasStructureId, specimen.atlasId);
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
            metadata: inputShape.metadata ?? null,
            atlasStructureId: inputShape.atlasStructureId,
            specimenId: inputShape.specimenId
        };

        return this.sequelize.transaction(async (t) => {
            if (!(await Specimen.findLiveAndLock(shape.specimenId, t))) {
                throw new Error("The requested specimen can not be found.");
            }

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

        const targetSpecimenId = shape.specimenId ?? this.specimenId;

        let targetAtlasId: string = null;

        if (targetSpecimenId !== this.specimenId) {
            // The target must be live, as creation requires: a neuron moved onto a deleted specimen would stay a candidate
            // with no specimen label to sort by.  The current specimen may already be deleted, and its atlas still applies.
            const [currentAtlasId, target] = await Promise.all([
                Specimen.findAtlasId(this.specimenId),
                Specimen.findByPk(targetSpecimenId, {attributes: ["id", "atlasId"]})
            ]);

            if (!target) {
                throw new Error("The requested specimen can not be found.");
            }

            if (target.atlasId !== currentAtlasId) {
                throw new Error("A neuron can not be moved to a specimen in a different atlas.");
            }

            targetAtlasId = target.atlasId;
        }

        // Null is ok (inherited),  Undefined is ok (no change).  Id of length zero treated as null.  Otherwise, must
        // find an atlas structure in the specimen's atlas.
        if (shape.atlasStructureId) {
            targetAtlasId ??= await Specimen.findAtlasId(targetSpecimenId);

            Neuron.assertStructureInAtlas(shape.atlasStructureId, targetAtlasId);
        } else if (shape.atlasStructureId !== undefined && shape.atlasStructureId !== null) {
            // Zero-length string
            shape.atlasStructureId = null;
        }

        // Undefined is ok (no update) - but prefer not null
        if (shape.keywords !== undefined) {
            shape.keywords = normalizeKeywords(shape.keywords);
        }

        if (shape.metadata) {
            shape.metadata = mergeJsonProperties(this.metadata, shape.metadata);
        }

        if (shape.specimenSoma === null) {
            shape.specimenSoma = {x: 0, y: 0, z: 0};
        }

        if (shape.atlasSoma === null) {
            shape.atlasSoma = {x: 0, y: 0, z: 0};
        }

        return await Neuron.sequelize.transaction(async (t) => {
            if (targetSpecimenId !== this.specimenId && !(await Specimen.findLiveAndLock(targetSpecimenId, t))) {
                throw new Error("The requested specimen can not be found.");
            }

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
            if (!Atlas.getAtlasForStructure(shape.atlasStructureId)) {
                throw new Error("The requested atlas structure can not be found.");
            }

            const specimenIds = _.uniq(neurons.map(neuron => neuron.specimenId));

            // paranoid: false for the same reason as Specimen.findAtlasId.
            const specimens = await Specimen.findAll({where: {id: {[Op.in]: specimenIds}}, attributes: ["id", "atlasId"], paranoid: false});

            const atlasIds = new Map<string, string>(specimens.map(specimen => [specimen.id, specimen.atlasId]));

            // Walks the neurons' specimen ids rather than the rows returned, so an id that resolves to no row fails
            // instead of being skipped.
            for (const specimenId of specimenIds) {
                Neuron.assertStructureInAtlas(shape.atlasStructureId, atlasIds.get(specimenId) ?? null);
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

    public static async reconstructionCounts(neuronIds: readonly string[]): Promise<number[]> {
        const rows = await Reconstruction.count({where: {neuronId: {[Op.in]: [...neuronIds]}}, group: ["neuronId"]});

        // Postgres returns a grouped COUNT as a bigint string.
        const counts = new Map(rows.map(row => [row["neuronId"] as string, Number(row.count)]));

        return neuronIds.map(neuronId => counts.get(neuronId) ?? 0);
    }

    public static async reconstructionsByNeuron(neuronIds: readonly string[]): Promise<Reconstruction[][]> {
        // hasMany, so every revision of the neuron: without the include, phaseFailure and atlasReconstruction
        // would each fetch the child once per row.
        const rows = await Reconstruction.findAll({where: {neuronId: {[Op.in]: [...neuronIds]}}, include: [{model: AtlasReconstruction}]});

        const byNeuron = _.groupBy(rows, row => row.neuronId);

        return neuronIds.map(neuronId => byNeuron[neuronId] ?? []);
    }

    public static async publishedByNeuron(neuronIds: readonly string[]): Promise<AtlasReconstruction[]> {
        const rows = await Reconstruction.findAll({
            where: {neuronId: {[Op.in]: [...neuronIds]}, status: ReconstructionStatus.Published},
            include: [{model: AtlasReconstruction}]
        });

        const byNeuron = new Map<string, AtlasReconstruction>();

        for (const row of rows) {
            if (!byNeuron.has(row.neuronId)) {
                byNeuron.set(row.neuronId, row.AtlasReconstruction ?? null);
            }
        }

        return neuronIds.map(neuronId => byNeuron.get(neuronId) ?? null);
    }

    /**
     * A neuron is untraceable when someone gave up on it and nothing else is happening on it: at least one
     * reconstruction was marked Untraceable and no live work remains.  Marking soft-deletes the row, so this is the one
     * query that has to look past paranoid - which also surfaces discarded rows, hence testing deletedAt rather than
     * status for the second half.
     */
    public static async untraceableByNeuron(neuronIds: readonly string[]): Promise<boolean[]> {
        const rows = await Reconstruction.findAll({
            where: {neuronId: {[Op.in]: [...neuronIds]}},
            attributes: ["neuronId", "status", "deletedAt"],
            paranoid: false
        });

        const byNeuron = _.groupBy(rows, row => row.neuronId);

        return neuronIds.map(neuronId => {
            const reconstructions = byNeuron[neuronId] ?? [];

            return reconstructions.some(reconstruction => reconstruction.status == ReconstructionStatus.Untraceable)
                && reconstructions.every(reconstruction => reconstruction.deletedAt != null);
        });
    }

    private static constructFindOptions(input: NeuronQueryInput): FindOptions {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: [this.specimenInclude(input)]});

        options = optionsWhereSpecimenIds(input, options);

        options = optionsWhereAtlasStructureIds(input, options);

        this.applyNeuronFilters(options, input);

        this.applyStatusInclude(options, input);

        return options;
    }

    public async assignCanonicalDoi(user: User, publicationYear: number, relatedIdentifiers: DataCiteRelatedIdentifier[], t: Transaction): Promise<CanonicalDoiResult> {
        if (this.canonicalDoi) {
            return {serviceStatus: DataCiteServiceStatus.Success, serviceError: null, doi: this.canonicalDoi};
        }

        const options = CoreServiceOptions.rest.doiGeneration;

        const specimen = this.Specimen ?? await this.getSpecimen({include: [{model: Collection}], transaction: t});
        const collection = specimen.Collection ?? await specimen.getCollection({transaction: t});

        // Registered findable in this single call, deliberately: the canonical identifies the neuron rather than any
        // one reconstruction of it, so it is citable from the moment it exists whatever state the reconstruction is in.
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
            return {serviceStatus: doiResult.serviceStatus, serviceError: doiResult.serviceError, doi: null};
        }

        // Logged before the local write, not after it: this line is the only trace the registration leaves if the
        // write or the commit that follows fails, and an orphaned identifier is only findable by hand through it.
        debug(`canonical doi registered for neuron ${this.label}: ${doiResult.doi}`);

        await this.update({canonicalDoi: doiResult.doi}, {transaction: t});

        await recordEvent({
            kind: EventLogItemKind.NeuronAssignDoi,
            targetId: this.id,
            parentId: this.specimenId,
            details: {doi: doiResult.doi},
            userId: user.id
        }, t);

        return {serviceStatus: DataCiteServiceStatus.Success, serviceError: null, doi: doiResult.doi};
    }

    public toPortalFormat(): PortalNeuron {
        // Assumes/requires relationships have been eager-loaded.
        return {
            id: this.id,
            label: this.label,
            canonicalDoi: this.canonicalDoi?.trim() || null,
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
        metadata: {
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
