import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, literal, Op, Sequelize, Transaction} from "sequelize";
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
import {SearchIndex} from "./searchIndex";
import {PredicateType} from "./queryPredicate";
import {AtlasReconstruction} from "./atlasReconstruction";
import {User} from "./user";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {isNullOrEmpty} from "../util/objectUtil";
import {Reconstruction} from "./reconstruction";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {Atlas} from "./atlas";
import {ReconstructionStatus} from "./reconstructionStatus";
import {publishedCount} from "./systemSettings";

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

export type SearchOutputPage = {
    nonce: string;
    queryTime: number;
    totalCount: number;
    neurons: Neuron[];
    error: Error;
}

enum FilterComposition {
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
            if (input.somaProperties.limitBrightness && input.somaProperties.brightnessRange?.length > 1) {
                options.where["somaProperties"] = {
                    brightness:  { [Op.between]: input.somaProperties.brightnessRange.slice(0, 2)}
                };
            }

            if (input.somaProperties.limitVolume && input.somaProperties.volumeRange?.length > 1) {
                if (!options.where["somaProperties"]) {
                    options.where["somaProperties"] = {};
                }
                options.where["somaProperties"]["volume"] =  { [Op.between]: input.somaProperties.volumeRange.slice(0, 2)}
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
            keywords: inputShape.keywords ?? [],
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

    public static async getNeuronsWithPredicates(context: SearchContext): Promise<SearchOutputPage> {
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
        const findOptions: FindOptions[] = context.Predicates.map((predicate) => predicate.createFindOptions(context.CollectionIds));

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

    public static async startReconstruction(user: User, neuronId: string): Promise<Reconstruction> {
        if (!user?.canAnnotate()) {
            throw new UnauthorizedError();
        }

        return Reconstruction.openReconstruction(neuronId, user);
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
