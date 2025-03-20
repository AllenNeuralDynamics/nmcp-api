import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, Op, Sequelize} from "sequelize";

import "fs";
import * as _ from "lodash";

import {BaseModel, DeleteOutput, EntityMutateOutput, EntityQueryInput, EntityQueryOutput} from "./baseModel";
import {
    optionsWhereCompartmentIds,
    optionsWhereIds,
    optionsWhereSampleIds,
    WithCompartmentQueryInput,
    WithReconstructionStatusQueryInput,
    WithSamplesQueryInput
} from "./findOptions";
import {BrainArea} from "./brainArea";
import {Sample} from "./sample";
import {IAnnotationMetadata} from "./annotationMetadata";
import {Tracing} from "./tracing";
import {TracingNode} from "./tracingNode";
import {ConsensusStatus} from "./ConsensusStatus";
import {SearchContext} from "./searchContext";
import {SearchContent} from "./searchContent";
import {PredicateType} from "./queryPredicate";
import {TracingStructure} from "./tracingStructure";
import {Reconstruction} from "./reconstruction";
import {ReconstructionStatus} from "./reconstructionStatus";
import {User} from "./user";

const debug = require("debug")("mnb:nmcp-api:neuron-model");

type NeuronCache = Map<string, Neuron>;

export type NeuronQueryInput =
    EntityQueryInput
    & WithSamplesQueryInput
    & WithCompartmentQueryInput
    & WithReconstructionStatusQueryInput
    & {
    tag?: string
};

export interface NeuronInput {
    id?: string;
    idNumber?: number;
    idString?: string;
    tag?: string;
    keywords?: string;
    x?: number;
    y?: number;
    z?: number;
    sampleX?: number;
    sampleY?: number;
    sampleZ?: number;
    doi?: string;
    metadata?: string;
    consensus?: ConsensusStatus;
    brainStructureId?: string;
    sampleId?: string;
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
    public idNumber: number;
    public idString: string;
    public tag: string;
    public keywords: string;
    public x: number;
    public y: number;
    public z: number;
    public doi: string;
    public metadata?: string;
    public consensus: ConsensusStatus;
    public brainStructureId?: string;

    public annotationMetadata?: IAnnotationMetadata;

    public getSample!: BelongsToGetAssociationMixin<Sample>;
    public getBrainArea!: BelongsToGetAssociationMixin<BrainArea>;
    public getTracings!: HasManyGetAssociationsMixin<Tracing>;
    public getReconstructions!: HasManyGetAssociationsMixin<Reconstruction>;

    public tracings?: Tracing[];
    public brainStructure: BrainArea;
    public Reconstructions?: Reconstruction[];
    public Sample?: Sample;

    private static _neuronCache: NeuronCache = new Map<string, Neuron>();

    public static getOneFromCache(id: string): Neuron {
        return this._neuronCache.get(id);
    }

    public static async updateCache(id: string) {
        const neuron = await Neuron.findByPk(id, {
            include: [
                {
                    model: BrainArea,
                    as: "BrainArea"
                },
                {
                    model: Tracing,
                    as: "tracings",
                    include: [{
                        model: TracingStructure,
                        as: "TracingStructure"
                    }, {
                        model: TracingNode,
                        as: "Soma"
                    }]
                }
            ]
        });

        this._neuronCache.set(neuron.id, neuron);
    }

    public static async loadNeuronCache() {
        try {
            debug(`loading neurons`);

            const neurons: Neuron[] = await Neuron.findAll({
                include: [
                    {
                        model: BrainArea,
                        as: "BrainArea"
                    }
                ]
            });

            debug(`loaded ${neurons.length} neurons`);

            neurons.map((n) => {
                this._neuronCache.set(n.id, n);
            });
        } catch (err) {
            debug(err)
        }
    }

    public static async getAll(input: NeuronQueryInput): Promise<EntityQueryOutput<Neuron>> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: [{model: Sample, as: "Sample"}]});

        options = optionsWhereSampleIds(input, options);
        options = optionsWhereCompartmentIds(input, options);

        if (input && input.reconstructionStatus) {
            options.where = Object.assign(options.where || {}, {"$Reconstructions.status$": ReconstructionStatus.Complete});

            const include = {
                model: Reconstruction,
                as: "Reconstructions",
                attributes: ["id", "status"],
                required: true
            };

            if (options.include) {
                // @ts-ignore
                options.include.push(include)
            } else {
                options.include = [include];
            }

            const neurons = await Neuron.findAll(options);

            return {totalCount: neurons.length, items: neurons};
        }

        const count = await this.setSortAndLimiting(options, input);

        options.order = [[{model: Sample, as: "Sample"}, 'animalId', "ASC"], ["idString", "ASC"]];
        try {
            const neurons = await Neuron.findAll(options);

            return {totalCount: count, items: neurons};
        } catch (err) {
            debug(err);
        }

        return {totalCount: 0, items: []};
    }

    public static async getNeurons(sampleId: string): Promise<Neuron[]> {
        if (!sampleId || sampleId.length === 0) {
            return Neuron.findAll({});
        }

        return Neuron.findAll({
            where: {sampleId: {[Op.eq]: sampleId}},
            order: [["idString", "ASC"]]
        });
    }

    public static async getCandidateNeuronsForUser(userId: string): Promise<Neuron[]> {
        const annotations = await Reconstruction.findAll({
            where: {annotatorId: userId, status: ReconstructionStatus.Approved}
        });

        const neuronPromises = annotations.map(async (t) => {
            return await t.getNeuron();
        })

        return await Promise.all(neuronPromises);
    }

    public static async getCandidateNeuronsForReview(): Promise<Neuron[]> {
        const annotations = await Reconstruction.findAll({
            where: {status: ReconstructionStatus.Approved}
        });

        const neuronPromises = annotations.map(async (t) => {
            return await t.getNeuron();
        })

        return await Promise.all(neuronPromises);
    }

    public static async getCandidateNeurons(input: NeuronQueryInput, includeInProgress: boolean = false): Promise<EntityQueryOutput<Neuron>> {
        const neuronIds = (await Neuron.findAll({attributes: ["id"]})).map(n => n.id);

        const reconstructionWhere = includeInProgress ? {status: ReconstructionStatus.Complete} : null;

        const neuronIdsWithCompletedReconstruction = (await Reconstruction.findAll({
            where: reconstructionWhere,
            attributes: ["neuronId"]
        })).map(t => t.neuronId);

        const neuronsWithCompletedReconstruction = _.uniq(neuronIdsWithCompletedReconstruction);

        const candidateNeuronIds = _.difference(neuronIds, neuronsWithCompletedReconstruction);

        const options = {where: {id: {[Op.in]: candidateNeuronIds}}, include: []};

        if (input.tag) {
            options.where["tag"] = {[Op.iLike]: `%${input.tag}%`};
        }

        if (input.brainStructureIds && input.brainStructureIds.length > 0) {
            options.where["brainStructureId"] = {[Op.in]: input.brainStructureIds}
        }

        if (input.sampleIds && input.sampleIds.length > 0) {
            options.where["$Sample.id$"] = {[Op.in]: input.sampleIds}
            options.include.push({model: Sample, as: "Sample"})
        }

        const totalCount = await Neuron.count(options);

        if (input) {
            options["order"] = [["createdAt", "DESC"]];

            if (input.offset) {
                options["offset"] = input.offset;
            }

            if (input.limit) {
                options["limit"] = input.limit;
            }
        }

        try {
            const candidateNeurons = await Neuron.findAll(options);

            return {totalCount, items: candidateNeurons};
        } catch (e) {
            return {totalCount: 0, items: []}
        }
    }

    public static async isDuplicate(idString: string, sampleId: string, id: string = null): Promise<boolean> {
        if (!sampleId || !idString) {
            return false;
        }

        const sample = await Sample.findByPk(sampleId);

        if (!sample) {
            return false;
        }

        // All neurons for sample  that have the same idString
        const dupes = await Neuron.findAll({where: {sampleId: {[Op.eq]: sampleId}, idString}});

        return dupes.length > 0 && (!id || (id !== dupes[0].id));
    }

    public static async isDuplicateNeuronObj(neuron: NeuronInput): Promise<boolean> {
        return Neuron.isDuplicate(neuron.idString, neuron.sampleId, neuron.id);
    }

    public static async findOrCreateWithIdString(idString: string, sampleId: string): Promise<Neuron> {
        const [neuron] = await Neuron.findOrCreate({where: {idString, sampleId}});

        return neuron;
    }

    public static async createWith(neuronInput: NeuronInput): Promise<EntityMutateOutput<Neuron>> {
        try {
            const sample = await Sample.findByPk(neuronInput.sampleId);

            if (!sample) {
                return {source: null, error: "The sample can not be found"};
            }

            if (neuronInput.brainStructureId) {
                const brainArea = await BrainArea.findByPk(neuronInput.brainStructureId);
                if (!brainArea) {
                    return {source: null, error: "The brain area can not be found"};
                }
            } else if (neuronInput.brainStructureId !== null) {
                // Zero-length string or undefined
                neuronInput.brainStructureId = null;
            }

            if (await Neuron.isDuplicateNeuronObj(neuronInput)) {
                return {source: null, error: `a neuron id "${neuronInput.idString}" already exists on this sample`};
            }

            const neuron = await Neuron.create({
                idNumber: neuronInput.idNumber || 0,
                idString: (neuronInput.idString || "").trim(),
                tag: neuronInput.tag || "",
                keywords: neuronInput.keywords || "",
                x: neuronInput.x || 0,
                y: neuronInput.y || 0,
                z: neuronInput.z || 0,
                consensus: neuronInput.consensus || ConsensusStatus.None,
                brainStructureId: neuronInput.brainStructureId,
                sampleId: neuronInput.sampleId
            });

            return {source: neuron, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async updateWith(neuronInput: NeuronInput): Promise<EntityMutateOutput<Neuron>> {
        try {
            let row = await Neuron.findByPk(neuronInput.id);

            if (!row) {
                return {source: null, error: "The neuron could not be found"};
            }

            const sample = await row.getSample();

            const isDupe = await Neuron.isDuplicate(neuronInput.idString || row.idString, neuronInput.sampleId || sample.id, row.id);

            if (isDupe) {
                return {source: null, error: `A neuron id "${neuronInput.idString}" already exists on this sample`};
            }

            // Undefined is ok (no update) - null, or empty is not - unless it is already that way from create
            if (this.isNullOrEmpty(neuronInput.idString) && row.idString) {
                return {source: null, error: "The idString cannot be empty"};
            } else if (neuronInput.idString !== undefined) {
                neuronInput.idString = neuronInput.idString.trim();
            }

            if (this.isNullOrEmpty(neuronInput.sampleId)) {
                return {source: null, error: "Sample id cannot be empty"};
            }

            if (neuronInput.sampleId) {
                const sample = await Sample.findByPk(neuronInput.sampleId);

                if (!sample) {
                    return {source: null, error: "The sample can not be found"};
                }
            }

            // Null is ok (inherited),  Undefined is ok (no change).  Id of length zero treated as null.  Otherwise, must
            // find brain area.
            if (neuronInput.brainStructureId) {
                const brainArea = await BrainArea.findByPk(neuronInput.brainStructureId);

                if (!brainArea) {
                    return {source: null, error: "The brain area can not be found"};
                }
            } else if (neuronInput.brainStructureId !== undefined && neuronInput.brainStructureId !== null) {
                // Zero-length string
                neuronInput.brainStructureId = null;
            }

            // Undefined is ok (no update) - but prefer not null
            if (neuronInput.tag === null) {
                neuronInput.tag = "";
            }

            if (neuronInput.keywords === null) {
                neuronInput.keywords = "";
            }

            if (neuronInput.idNumber === null) {
                neuronInput.idNumber = 0;
            }

            if (neuronInput.x === null) {
                neuronInput.x = 0;
            }

            if (neuronInput.y === null) {
                neuronInput.y = 0;
            }

            if (neuronInput.z === null) {
                neuronInput.z = 0;
            }

            if (neuronInput.sampleX === null) {
                neuronInput.sampleX = 0;
            }

            if (neuronInput.sampleY === null) {
                neuronInput.sampleY = 0;
            }

            if (neuronInput.sampleZ === null) {
                neuronInput.sampleZ = 0;
            }

            if (neuronInput.consensus === null) {
                neuronInput.consensus = ConsensusStatus.None;
            }

            const neuron = await row.update(neuronInput);

            return {source: neuron, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }


    public static async deleteFor(id: string): Promise<DeleteOutput> {
        if (!id || id.length === 0) {
            return null;
        }

        try {
            const count = await Neuron.destroy({where: {id}});

            if (count > 0) {
                return {id, error: null}
            }

            return {id, error: "The neuron could not be removed."};
        } catch (error) {
            return {id, error: error.message};
        }
    }

    public static async unpublish(id: string): Promise<boolean> {
        if (!id) {
            return false;
        }

        const neuron = await Neuron.findByPk(id, {
            include: [
                {
                    model: Reconstruction,
                    as: "Reconstructions",
                    attributes: ["id", "status"],
                    required: true
                }
            ]
        });

        if (!neuron) {
            return false;
        }

        const published = neuron.Reconstructions.filter(r => r.status == ReconstructionStatus.Complete);

        if (published.length == 0) {
            return false;
        }

        await Promise.all(published.map(async (p) => await Reconstruction.unpublish(p.id)));

        return true;
    }

    public static async getNeuronsWithPredicates(context: SearchContext): Promise<IQueryDataPage> {
        try {
            const start = Date.now();

            let neurons = await this.performNeuronsFilterQuery(context);

            const duration = Date.now() - start;

            const totalCount = Reconstruction.reconstructionCount();

            neurons = neurons.sort((b, a) => a.idString.localeCompare(b.idString));

            return {nonce: context.Nonce, queryTime: duration, totalCount, neurons, error: null};

        } catch (err) {
            debug(err);

            return {nonce: context.Nonce, queryTime: -1, totalCount: 0, neurons: [], error: err};
        }
    }

    private static async performNeuronsFilterQuery(context: SearchContext): Promise<Neuron[]> {
        const start = Date.now();

        const queries = context.Predicates.map((predicate) => {
            return predicate.createFindOptions();
        });

        const contentPromises: Promise<SearchContent[]>[] = queries.map(async (query) => {
            return SearchContent.findAll(query);
        });

        // An array (one for each filter entry) of an array of compartments (all returned for each filter).
        const contents: SearchContent[][] = await Promise.all(contentPromises);

        // Not interested in individual compartment results.  Just want unique tracings mapped back to neurons for
        // grouping.  Need to restructure by neurons before applying composition.
        const results: Neuron[][] = contents.map((c, index) => {
            let compartments = c;

            const predicate = context.Predicates[index];

            if (predicate.predicateType === PredicateType.CustomRegion && predicate.arbCenter && predicate.arbSize) {
                const pos = predicate.arbCenter;

                compartments = compartments.filter((comp) => {
                    const distance = Math.sqrt(Math.pow(pos.x - comp.somaX, 2) + Math.pow(pos.y - comp.somaY, 2) + Math.pow(pos.z - comp.somaZ, 2));

                    return distance <= predicate.arbSize;
                });
            }

            return compartments.map(c => {
                return Neuron.getOneFromCache(c.neuronId);
            });
        });

        let neurons = results.reduce((prev, curr, index) => {
            if (index === 0 || context.Predicates[index].composition === FilterComposition.or) {
                return _.uniqBy(prev.concat(curr), "id");
            } else if (context.Predicates[index].composition === FilterComposition.and) {
                return _.uniqBy(_.intersectionBy(prev, curr, "id"), "id");
            } else {
                // Not
                return _.uniqBy(_.differenceBy(prev, curr, "id"), "id");
            }
        }, []);

        const duration = Date.now() - start;

        // await this._metricStorageManager.logQuery(context, queries, "", duration);

        return neurons;
    }

    public static async requestAnnotation(neuronId: string, annotator: User): Promise<Neuron> {
        const neuron = await Neuron.findByPk(neuronId);

        try {
            const existingAnnotation = await Reconstruction.findOne({
                where: {
                    annotatorId: annotator.id,
                    neuronId: neuronId
                }
            });

            if (existingAnnotation) {
                if (existingAnnotation.status == ReconstructionStatus.InReview || existingAnnotation.status == ReconstructionStatus.OnHold) {
                    await existingAnnotation.update({status: ReconstructionStatus.InProgress});
                }

                return neuron;
            }

            await Reconstruction.create({
                neuronId: neuronId,
                annotatorId: annotator.id,
                status: ReconstructionStatus.InProgress,
                notes: "",
                durationMinutes: 0,
                startedAt: Date.now()
            })
        } catch (err) {
            debug(err);
        }

        return neuron;
    }

    public static async getReconstructionsAsData(id: string): Promise<string> {
        const reconstruction = await Reconstruction.findOne({
            where: {
                neuronId: id
            },
            attributes: ["id"]
        });

        if (reconstruction) {
            return await Reconstruction.getAsData(reconstruction.id);
        }

        return null;
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Neuron.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        idNumber: {
            type: DataTypes.INTEGER,
            defaultValue: -1
        },
        idString: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        tag: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        keywords: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        x: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        y: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        z: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        sampleX: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        sampleY: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        sampleZ: {
            type: DataTypes.DOUBLE,
            defaultValue: 0
        },
        doi: {
            type: DataTypes.TEXT
        },
        consensus: {
            type: DataTypes.INTEGER
        },
        metadata: {
            type: DataTypes.TEXT
        },
        annotationMetadata: {
            type: DataTypes.VIRTUAL,
            get: function (): IAnnotationMetadata {
                return JSON.parse(this.getDataValue("metadata")) || [];
            },
            set: function (value: IAnnotationMetadata) {
                this.setDataValue("metadata", JSON.stringify(value));
            }
        }
    }, {
        tableName: "Neuron",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Neuron.belongsTo(Sample, {foreignKey: "sampleId", as: "Sample"});
    Neuron.belongsTo(BrainArea, {foreignKey: {name: "brainStructureId", allowNull: true}});
    Neuron.hasMany(Reconstruction, {foreignKey: "neuronId", as: "Reconstructions"});
};
