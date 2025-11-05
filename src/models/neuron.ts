import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, literal, Op, Sequelize} from "sequelize";
import "fs";
import * as _ from "lodash";
import {validate as uuidValidate, version as uuidVersion} from "uuid";

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
import {SearchIndex} from "./searchIndex";
import {PredicateType} from "./queryPredicate";
import {AtlasReconstruction} from "./atlasReconstruction";
import {AtlasReconstructionStatus} from "./atlasReconstructionStatus";
import {User} from "./user";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {parseSomaPropertySteam} from "../io/somaPropertyParser";
import {isNotNullOrUndefined, isNullOrEmpty} from "../util/objectUtil";
import {Reconstruction} from "./reconstruction";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {Atlas} from "./atlas";
import {ReconstructionStatus} from "./reconstructionStatus";
import {AtlasNode} from "./atlasNode";
import {publishedCount} from "./systemSettings";

const debug = require("debug")("nmcp:nmcp-api:neuron-model");

type NeuronCache = Map<string, Neuron>;

function getSequelizeOperator(operator: SomaFilterOperator, value: number) {
    switch (operator) {
        case SomaFilterOperator.LessThan:
            return {[Op.lt]: value};
        case SomaFilterOperator.GreaterThan:
            return {[Op.gt]: value};
        case SomaFilterOperator.Equals:
        default:
            return value;
    }
}

function isValidSomaFilterOperator(operator: SomaFilterOperator): boolean {
    return isNotNullOrUndefined(operator) && operator != SomaFilterOperator.None;
}

export type SomaLocation = {
    x: number;
    y: number;
    z: number;
}

export enum SomaFilterOperator {
    None = 0,
    Equals = 1,
    LessThan = 2,
    GreaterThan = 3
}

export type SomaFilterInput = {
    brightnessOperator: SomaFilterOperator;
    brightness: number;
    volumeOperator: SomaFilterOperator;
    volume: number;
}

export type SomaProperties = {
    brightness?: number;
    volume?: number;
}

export type SomaImportOptions = {
    specimenId: string;
    keywords: string[];
    shouldLookupSoma: boolean;
    noEmit: boolean;
}

export type SomaImportResponse = {
    count: number;
    idStrings: string[];
    error: Error;
}

export type NeuronQueryInput =
    EntityQueryInput
    & WithSpecimensQueryInput
    & WithAtlasStructureQueryInput
    & {
    keywords?: string[];
    somaProperties?: SomaFilterInput;
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

export type NeuronCreateOrUpdateOptions = {
    allowCreate?: boolean;
    allowMatchLabel?: boolean;
    substituteUser?: User;
}

export interface IQueryDataPage {
    nonce: string;
    queryTime: number;
    totalCount: number;
    neurons: Neuron[];
    error: Error;
}

export enum FilterComposition {
    and = 1,
    or = 2,
    not = 3
}

export class Neuron extends BaseModel {
    public label: string;
    public keywords: string[];
    public specimenSoma: SomaLocation;
    public atlasSoma: SomaLocation
    public somaProperties?: SomaProperties;
    public specimenId: string;
    public atlasStructureId?: string;

    public getSpecimen!: BelongsToGetAssociationMixin<Specimen>;
    public getAtlasStructure!: BelongsToGetAssociationMixin<AtlasStructure>;
    public getSpecimenReconstruction!: HasManyGetAssociationsMixin<Reconstruction>;

    public AtlasStructure: AtlasStructure;
    public Specimen?: Specimen;

    public static async publishedCount(): Promise<number> {
        return await Reconstruction.count({where: {status: ReconstructionStatus.Published}, distinct: true, col: "neuronId"});
    }

    public static async getAll(input: NeuronQueryInput): Promise<EntityQueryOutput<Neuron>> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: [{model: Specimen, as: "Specimen"}]});

        options = optionsWhereSpecimenIds(input, options);
        options = optionsWhereAtlasStructureIds(input, options);

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

        const options = {where: {id: {[Op.in]: candidateNeuronIds}}, include: [], offset: 0};

        const keywords = input.keywords?.filter(k => k && k.trim().length > 0) ?? [];

        if (keywords.length > 0) {
            options.where["keywords"] = literal(`EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text("Neuron"."keywords") AS elem
            WHERE elem ILIKE '%${input.keywords[0]}%'
          )`); //{[Op.iLike]: `%${input.keywords[0]}%`};
        }

        if (input.atlasStructureIds && input.atlasStructureIds.length > 0) {
            // TODO Atlas for multiple atlases to be supported, input.atlasStructureIds will have to have been selected from a specific atlas, which will need
            //  to have been added to the input args, and will be used for this step instead of hard-coded defaultAtlas.
            const comprehensiveBrainAreas = input.atlasStructureIds.map(id => Atlas.defaultAtlas.getComprehensiveBrainArea(id)).reduce((prev, curr) => {
                return prev.concat(curr);
            }, []);

            options.where["atlasStructureId"] = {
                [Op.in]: comprehensiveBrainAreas
            };
        }

        if (input.somaProperties) {
            if (isValidSomaFilterOperator(input.somaProperties.brightnessOperator) && isNotNullOrUndefined(input.somaProperties.brightness)) {
                options.where["somaProperties"] = {
                    brightness: getSequelizeOperator(input.somaProperties.brightnessOperator, input.somaProperties.brightness)
                };
            }

            if (isValidSomaFilterOperator(input.somaProperties.volumeOperator) && isNotNullOrUndefined(input.somaProperties.volume)) {
                if (!options.where["somaProperties"]) {
                    options.where["somaProperties"] = {};
                }
                options.where["somaProperties"]["volume"] = getSequelizeOperator(input.somaProperties.volumeOperator, input.somaProperties.volume);
            }
        }

        options.include.push({model: Specimen, as: "Specimen", attributes: ["id", "label"]});

        if (input.specimenIds && input.specimenIds.length > 0) {
            options.where["$Specimen.id$"] = {[Op.in]: input.specimenIds}
        }

        const totalCount = await Neuron.count(options);

        options["order"] = [["Specimen", "label", "ASC"], ["label", "ASC"]];

        if (input) {
            if (input.offset) {
                options["offset"] = Math.max(0, Math.min(input.offset, totalCount - (input.limit ? (totalCount % input.limit) : 0)));
            }

            if (input.limit) {
                options["limit"] = input.limit;
            }
        }

        try {
            const candidateNeurons = await Neuron.findAll(options);

            return {totalCount, offset: options.offset, items: candidateNeurons};
        } catch (e) {
            return {totalCount: 0, offset: 0, items: []}
        }
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

    private static async createForShape(shape: NeuronShape, user: User, substituteUser: User): Promise<Neuron> {
        const specimen = await Specimen.findByPk(shape.specimenId);

        if (!specimen) {
            throw new Error("The requested specimen can not be found.");
        }

        if (shape.atlasStructureId) {
            const atlasStructure = await AtlasStructure.findByPk(shape.atlasStructureId);
            if (!atlasStructure) {
                throw new Error("The requested atlas structure can not be found.");
            }
        } else if (shape.atlasStructureId !== null) {
            // Zero-length string or undefined
            shape.atlasStructureId = null;
        }

        if (await Neuron.isDuplicateNeuronObj(shape)) {
            throw new Error(`a neuron id "${shape.label}" already exists on this specimen.`);
        }

        return this.sequelize.transaction(async (t) => {
            const neuron = await this.create({
                label: (shape.label ?? "").trim(),
                keywords: shape.keywords ?? [],
                specimenSoma: shape.specimenSoma ?? {x: 0, y: 0, z: 0},
                atlasSoma: shape.atlasSoma ?? {x: 0, y: 0, z: 0},
                atlasStructureId: shape.atlasStructureId,
                specimenId: shape.specimenId
            }, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.NeuronCreate,
                targetId: neuron.id,
                userId: user.id,
                parentId: specimen.id,
                details: shape,
                substituteUserId: substituteUser?.id
            }, t);

            return neuron;
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
        if (shape.keywords === null) {
            shape.keywords = [];
        }

        if (shape.specimenSoma === null) {
            shape.specimenSoma = {x: 0, y: 0, z: 0};
        }

        if (shape.atlasSoma === null) {
            shape.atlasSoma = {x: 0, y: 0, z: 0};
        }

        return await Neuron.sequelize.transaction(async (t) => {
            const neuron = await this.update(shape, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.NeuronUpdate,
                targetId: neuron.id,
                parentId: neuron.specimenId,
                userId: user.id,
                details: shape,
                substituteUserId: substituteUser?.id
            }, t);

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
                await recordEvent({
                    kind: EventLogItemKind.NeuronDelete,
                    targetId: id,
                    parentId: neuron?.specimenId,
                    userId: user.id
                }, t);

                return id;
            }

            await t.rollback();

            throw new Error(`The neuron could not be removed.  Verify ${id} is a valid neuron id.`);
        });
    }

    public static async getNeuronsWithPredicates(context: SearchContext): Promise<IQueryDataPage> {
        try {
            const start = Date.now();

            let neurons = await this.performNeuronsFilterQuery(context);

            const duration = Date.now() - start;

            const totalCount = await publishedCount();

            neurons = neurons.sort((b, a) => a.label.localeCompare(b.label));

            return {nonce: context.Nonce, queryTime: duration, totalCount, neurons, error: null};

        } catch (err) {
            debug(err);
            debug(context);

            return {nonce: context.Nonce, queryTime: 1, totalCount: 0, neurons: [], error: err};
        }
    }

    private static async performNeuronsFilterQuery(context: SearchContext): Promise<Neuron[]> {
        const somaProperties = ["somaX", "somaY", "somaZ"];

        // FindOptions per-predicate.
        const findOptions: FindOptions[] = context.Predicates.map((predicate) => predicate.createFindOptions());

        const indicesPerPredicate: (SearchIndex[])[] = [];

        const needSomas = context.Predicates.some(p => p.predicateType === PredicateType.CustomRegion && p.arbCenter && p.arbSize);

        const attributes = needSomas ? ["id", "neuronId", ...somaProperties] : ["id", "neuronId"];

        for (const option of findOptions) {
            option.attributes = attributes;
            indicesPerPredicate.push(await SearchIndex.findAll(option));
        }

        // Not interested in individual compartment results.  Just want unique neurons for per-predicate.
        const neuronIdsPerPredicate: string[][] = indicesPerPredicate.map((indexList, index) => {
            // Additional filter for custom region.  May be able to do in database (?).
            const predicate = context.Predicates[index];

            if (predicate.predicateType === PredicateType.CustomRegion && predicate.arbCenter && predicate.arbSize) {
                const pos = predicate.arbCenter;

                indexList = indexList.filter((searchIndex) => {
                    const distance = Math.sqrt(Math.pow(pos.x - searchIndex.somaX, 2) + Math.pow(pos.y - searchIndex.somaY, 2) + Math.pow(pos.z - searchIndex.somaZ, 2));

                    return distance <= predicate.arbSize;
                });
            }

            return _.uniq(indexList.map(c => c.neuronId));
        });

        const neuronIds = neuronIdsPerPredicate.length == 1 ? neuronIdsPerPredicate[0] : neuronIdsPerPredicate.reduce((prev, curr, index) => {
            if (index === 0 || context.Predicates[index].composition === FilterComposition.or) {
                return _.uniqBy(prev.concat(curr), "id");
            } else if (context.Predicates[index].composition === FilterComposition.and) {
                return _.uniqBy(_.intersectionBy(prev, curr, "id"), "id");
            } else {
                // Not
                return _.uniqBy(_.differenceBy(prev, curr, "id"), "id");
            }
        }, []);

        return await this.findAll({where: {id: {[Op.in]: neuronIds}}});
    }

    public static async startReconstruction(neuronId: string, userOrId: User | string): Promise<Reconstruction> {
        const user = await User.findUserOrId(userOrId);

        if (!user?.canAnnotate()) {
            throw new UnauthorizedError();
        }

        return Reconstruction.openReconstruction(neuronId, user);
    }

    public static async findNextAvailableIdString(specimen: string): Promise<number> {
        const existingNeurons = await Neuron.findAll({
            where: {specimenId: specimen},
            attributes: ["idString"],
            order: [["idString", "DESC"]]
        });

        let nextNumber = 1;

        if (existingNeurons.length > 0) {
            const existingNumbers = existingNeurons
                .map(n => n.label)
                .filter(idString => /^N\d{3,}$/.test(idString))
                .map(idString => parseInt(idString.substring(1)))
                .filter(num => !isNaN(num));

            if (existingNumbers.length > 0) {
                nextNumber = Math.max(...existingNumbers) + 1;
            }
        }

        return nextNumber;
    }

    public static async receiveSomaPropertiesUpload(uploadFile: Promise<any>, options: SomaImportOptions): Promise<SomaImportResponse> {
        if (!uploadFile) {
            return {
                count: 0,
                idStrings: [],
                error: {name: "ImportSomasError", message: "There are no files attached to import."}
            };
        }

        if (!options.specimenId) {
            return {
                count: 0,
                idStrings: [],
                error: {name: "ImportSomasError", message: "A specimen id must be provided."}
            };
        }

        if (!uuidValidate(options.specimenId) || uuidVersion(options.specimenId) != 4) {
            return {
                count: 0,
                idStrings: [],
                error: {name: "ImportSomasError", message: "The specimen id must be UUID (v7) format."}
            };
        }

        const specimen = await Specimen.findByPk(options.specimenId);

        if (!specimen) {
            return {
                count: 0,
                idStrings: [],
                error: {name: "ImportSomasError", message: `Specimen with id ${options.specimenId} does not exist.`}
            };
        }

        try {
            let file = await uploadFile;

            debug(`import somas from ${file.filename}`);

            const records = await parseSomaPropertySteam(file.createReadStream(), specimen.getAtlas());

            const nextNumber = await Neuron.findNextAvailableIdString(specimen.id);

            if (options.keywords) {
                records.forEach(r => {
                    r.keywords = options.keywords
                });
            }

            const idStrings = await Neuron.insertSomaEntries(records, specimen, nextNumber, options.noEmit);

            return {
                count: records.length,
                idStrings: idStrings,
                error: null
            }
        } catch (error) {
            debug(`Error parsing soma properties: ${error.message}`);

            return {
                count: 0,
                idStrings: [],
                error: {name: "ImportSomasError", message: error.message}
            };
        }
    }

    public static async insertSomaEntries(records: any[], sample: Specimen, idNumberBase: number, noEmit: boolean = false): Promise<string[]> {
        const idStrings: string[] = [];

        const t = await Neuron.sequelize.transaction();

        try {
            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                const idString = `N${String(idNumberBase + i).padStart(3, "0")}`;
                // console.log(record);
                const neuron = await Neuron.create({
                    sampleId: sample.id,
                    idString: idString,
                    tag: record.tag,
                    x: record.ccfxyz?.x ?? 0,
                    y: record.ccfxyz?.y ?? 0,
                    z: record.ccfxyz?.z ?? 0,
                    sampleX: record.xyz?.x ?? 0,
                    sampleY: record.xyz?.y ?? 0,
                    sampleZ: record.xyz?.z ?? 0,
                    somaProperties: record,
                    brainStructureId: record.brainStructureId
                }, {transaction: t});

                idStrings.push(neuron.label);
            }

            if (!noEmit) {
                await t.commit();
            } else {
                debug(`Skipping database update (noEmit is true). Created ${idStrings.length} soma entries.`);
                await t.rollback();
            }
        } catch (error) {
            debug(`Error inserting soma entries: ${error.message}`);
            await t.rollback();
            throw new Error(`Failed to insert soma entries: ${error.message}`);
        }

        return idStrings;
    }

    public async published(): Promise<AtlasReconstruction> {
        const reconstruction = await Reconstruction.findOne({where: {neuronId: this.id, status: ReconstructionStatus.Published}});

        return await reconstruction?.getAtlasReconstruction();
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
