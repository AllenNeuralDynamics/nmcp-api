import {
    Sequelize,
    DataTypes,
    Op,
    BelongsToGetAssociationMixin,
    FindOptions, Transaction
} from "sequelize";

const parse = require("csv-parse");

import "fs";

import {BaseModel, DeleteOutput, EntityMutateOutput, EntityQueryInput, EntityQueryOutput} from "./baseModel";
import {
    optionsWhereCompartmentIds,
    optionsWhereIds,
    optionsWhereSampleIds, WithCompartmentQueryInput, WithSamplesQueryInput
} from "./findOptions";
import {BrainArea} from "./brainArea";
import {Sample} from "./sample";
import {IAnnotationMetadata} from "./annotationMetadata";
import {RegistrationKind} from "./registrationKind";
import {Tracing} from "./tracing";
import {StructureIdentifier, StructureIdentifiers} from "./structureIdentifier";
import {TracingNode} from "./tracingNode";

export enum ConsensusStatus {
    Full,
    Partial,
    Single,
    Pending,
    None
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

            await Tracing.createCandidateTracing(neuron);

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

            const tracing = await Tracing.getCandidateTracing(neuron.id);

            const soma = await TracingNode.findByPk(tracing.somaNodeId);

            const somaUpdates = {};

            if (neuron.x != soma.x) {
                somaUpdates["x"] = neuron.x;
            }

            if (neuron.y != soma.y) {
                somaUpdates["y"] = neuron.y;
            }

            if (neuron.z != soma.z) {
                somaUpdates["z"] = neuron.z;
            }

            if (neuron.brainStructureId != soma.brainStructureId) {
                somaUpdates["brainStructureId"] = neuron.brainStructureId;
            }

            if (Object.keys(somaUpdates).length > 0) {
                await soma.update(somaUpdates);
            }

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
                const candidateTracing = await Tracing.findOne({
                    where: {
                        neuronId: id,
                        registration: RegistrationKind.Candidate
                    }
                });

                if (candidateTracing) {
                    await Tracing.deleteTracing(candidateTracing.id);
                }

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
};
