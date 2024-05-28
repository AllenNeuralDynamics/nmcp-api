import {
    Sequelize,
    DataTypes,
    Op,
    BelongsToGetAssociationMixin,
    FindOptions, HasManyGetAssociationsMixin
} from "sequelize";

import "fs";
import * as _ from "lodash";

import {BaseModel, DeleteOutput, EntityMutateOutput, EntityQueryInput, EntityQueryOutput} from "./baseModel";
import {
    optionsWhereCompartmentIds,
    optionsWhereIds,
    optionsWhereSampleIds, WithCompartmentQueryInput, WithSamplesQueryInput
} from "./findOptions";
import {BrainArea} from "./brainArea";
import {Sample} from "./sample";
import {IAnnotationMetadata} from "./annotationMetadata";
import {Tracing} from "./tracing";
import {TracingNode} from "./tracingNode";
import {SearchScope} from "./SearchScope";
import {ConsensusStatus} from "./ConsensusStatus";
import {CcfVersion, SearchContext} from "./searchContext";
import {SearchContent} from "./searchContent";
import {PredicateType} from "./queryPredicate";
import {TracingStructure} from "./tracingStructure";
import {Reconstruction} from "./reconstruction";
import {ReconstructionStatus} from "./reconstructionStatus";
import {User} from "./user";

const debug = require("debug")("mnb:nmcp-api:neuron-model");

type NeuronCache = Map<string, Neuron>;

class NeuronCounts {
    [key: number]: number;
}

export type NeuronQueryInput =
    EntityQueryInput
    & WithSamplesQueryInput
    & WithCompartmentQueryInput;

export interface NeuronInput {
    id?: string;
    idNumber?: number;
    idString?: string;
    tag?: string;
    keywords?: string;
    x?: number;
    y?: number;
    z?: number;
    doi?: string;
    metadata?: string;
    consensus?: ConsensusStatus;
    visibility?: number;
    brainStructureId?: string;
    sampleId?: string;
}

export interface IUpdateAnnotationOutput {
    metadata: string;
    error: string;
}

export interface IQueryDataPage {
    nonce: string;
    ccfVersion: CcfVersion;
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
    public visibility: number;
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

    private static _neuronCache: NeuronCache = new Map<string, Neuron>();

    private static _neuronCounts = new NeuronCounts();

    public static getOneFromCache(id: string): Neuron {
        return this._neuronCache.get(id);
    }

    public static async updateCache(id: string) {
        const neuron = await Neuron.findByPk(id,{
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

    public static neuronCount(scope: SearchScope) {
        if (scope === null || scope === undefined) {
            return this._neuronCounts[SearchScope.Published];
        }

        return this._neuronCounts[scope];
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

            this._neuronCounts[SearchScope.Private] = this._neuronCounts[SearchScope.Team] = neurons.length;

            this._neuronCounts[SearchScope.Division] = this._neuronCounts[SearchScope.Internal] = this._neuronCounts[SearchScope.Moderated] = neurons.filter(n => n.visibility >= SearchScope.Division).length;

            this._neuronCounts[SearchScope.External] = this._neuronCounts[SearchScope.Public] = this._neuronCounts[SearchScope.Published] = neurons.filter(n => n.visibility >= SearchScope.External).length;

            debug(`${this.neuronCount(SearchScope.Team)} team-visible neurons`);
            debug(`${this.neuronCount(SearchScope.Internal)} internal-visible neurons`);
            debug(`${this.neuronCount(SearchScope.Public)} public-visible neurons`);
        } catch (err) {
            debug(err)
        }
    }

    public static async getAll(input: NeuronQueryInput): Promise<EntityQueryOutput<Neuron>> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsWhereSampleIds(input, options);
        options = optionsWhereCompartmentIds(input, options);

        const count = await this.setSortAndLimiting(options, input);

        const neurons = await Neuron.findAll(options);

        return {totalCount: count, items: neurons};
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

        const neuronPromises = annotations.map(async(t) => {
            return await t.getNeuron();
        })

        return await Promise.all(neuronPromises);
    }

    public static async getCandidateNeuronsForReview(): Promise<Neuron[]> {
        const annotations = await Reconstruction.findAll({
            where: {status: ReconstructionStatus.Approved}
        });

        const neuronPromises = annotations.map(async(t) => {
            return await t.getNeuron();
        })

        return await Promise.all(neuronPromises);
    }

    public static async getCandidateNeurons(input: NeuronQueryInput): Promise<EntityQueryOutput<Neuron>> {
        const neuronIds = (await Neuron.findAll({attributes: ["id"]})).map(n => n.id);

        const neuronIdsWithCompletedReconstruction = (await Reconstruction.findAll({where: {status: ReconstructionStatus.Complete}, attributes: ["neuronId"]})).map(t => t.neuronId);

        const neuronsWithCompletedReconstruction = _.uniq(neuronIdsWithCompletedReconstruction);

        const candidateNeuronIds = _.difference(neuronIds, neuronsWithCompletedReconstruction);

        const where = {id: {[Op.in]: candidateNeuronIds}};

        const include = [];

        if (input.brainStructureIds && input.brainStructureIds.length > 0) {
            where["brainStructureId"] = {[Op.in]: input.brainStructureIds}
        }

        if (input.sampleIds && input.sampleIds.length > 0) {
            where["$Sample.id$"] = {[Op.in]: input.sampleIds}
            where["$Sample.id$"] = {[Op.in]: input.sampleIds}
            include.push({model: Sample, as: "Sample"})
        }

        try {
            const candidateNeurons = await Neuron.findAll({where: where, include: include})

            return {totalCount: candidateNeuronIds.length, items: candidateNeurons};
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
                visibility: 1,
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

            if (neuronInput.visibility === null) {
                neuronInput.visibility = 1;
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

    public static async updateAnnotationMetadata(neuronId: string, upload: Promise<any>): Promise<IUpdateAnnotationOutput> {
        if (upload == null) {
            return {metadata: null, error: "ERROR: File not specified."};
        }

        const file = await upload;

        if (file == null) {
            return {metadata: null, error: "ERROR: File not specified."};
        }

        const neuron: Neuron = await Neuron.findByPk(neuronId);

        if (!neuron) {
            return {metadata: null, error: `ERROR: The neuron with id ${neuronId} could not be found.`};
        }
        const stream = file.createReadStream();

        return new Promise((resolve) => {
            let buffer: string = "";

            stream.on("readable", () => {
                let line: Buffer;

                while ((line = stream.read()) !== null) {
                    buffer += line.toString("utf8");
                }
            });

            stream.on("end", () => {
                console.log(buffer);

                try {
                    const data = JSON.parse(buffer) as IAnnotationMetadata;

                    if (data != null) {
                        neuron.annotationMetadata = data;
                    } else {
                        resolve({metadata: null, error: "ERROR: Could not parse annotation metadata."});
                    }
                } catch (error) {
                    resolve({metadata: null, error: "ERROR: Could not parse annotation metadata.\n" + error.toString()});
                }

                try {
                    neuron.save();
                } catch (error) {
                    resolve({metadata: null, error: "ERROR: Changes could not be committed.\n" + error.toString()});
                }

                resolve({metadata: buffer, error: null});
            });
        });
    }


    public static async getNeuronsWithPredicates(context: SearchContext): Promise<IQueryDataPage> {
        try {
            const start = Date.now();

            let neurons = await this.performNeuronsFilterQuery(context);

            const duration = Date.now() - start;

            const totalCount = Neuron.neuronCount(context.Scope);

            neurons = neurons.sort((b, a) => a.idString.localeCompare(b.idString));

            return {nonce: context.Nonce, ccfVersion: context.CcfVersion, queryTime: duration, totalCount, neurons, error: null};

        } catch (err) {
            debug(err);

            return {nonce: context.Nonce, ccfVersion: context.CcfVersion, queryTime: -1, totalCount: 0, neurons: [], error: err};
        }
    }

    private static async performNeuronsFilterQuery(context: SearchContext): Promise<Neuron[]> {
        const start = Date.now();

        const queries = context.Predicates.map((predicate) => {
            return predicate.createFindOptions(context.Scope);
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
                if (existingAnnotation.status == ReconstructionStatus.Cancelled || existingAnnotation.status == ReconstructionStatus.InReview || existingAnnotation.status == ReconstructionStatus.OnHold) {
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
        visibility: {
            type: DataTypes.INTEGER,
            defaultValue: 1
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
    Neuron.belongsTo(Sample, {foreignKey: "sampleId"});
    Neuron.belongsTo(BrainArea, {foreignKey: {name: "brainStructureId", allowNull: true}});
    Neuron.hasMany(Reconstruction, {foreignKey: "neuronId", as: "Reconstructions"});
};
