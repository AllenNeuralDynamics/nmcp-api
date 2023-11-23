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
    optionsWhereInjectionIds,
    optionsWhereSampleIds, WithCompartmentQueryInput, WithInjectionsQueryInput, WithSamplesQueryInput
} from "./findOptions";
import {BrainArea} from "./brainArea";
import {Injection} from "./injection";
import {swcApiClient} from "../external/swcApiService";
import {Sample} from "./sample";
import {Fluorophore} from "./fluorophore";
import {InjectionVirus} from "./injectionVirus";
import {IAnnotationMetadata} from "./annotationMetadata";

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
    & WithInjectionsQueryInput
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
    annotationMetadata?: string;
    consensus?: ConsensusStatus;
    sharing?: number;
    brainAreaId?: string;
    injectionId?: string;
}

export interface IUpdateAnnotationOutput {
    annotationMetadata: string;
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
    public annotationMetadata?: string;
    public sharing: number;
    public consensus: ConsensusStatus;

    public metadata?: IAnnotationMetadata;

    public getInjection!: BelongsToGetAssociationMixin<Injection>;
    public getBrainArea!: BelongsToGetAssociationMixin<BrainArea>;

    public static async getAll(input: NeuronQueryInput): Promise<EntityQueryOutput<Neuron>> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        if (input && input.sampleIds && input.sampleIds.length > 0) {
            const injectionIds = (await Injection.findAll(optionsWhereSampleIds(input))).map((obj: Injection) => obj.id);

            if (injectionIds.length === 0) {
                return {totalCount: 0, items: []};
            }

            input.injectionIds = injectionIds.concat(input.injectionIds || []);
        }

        options = optionsWhereInjectionIds(input, options);
        options = optionsWhereCompartmentIds(input, options);

        const count = await this.setSortAndLimiting(options, input);

        const neurons = await Neuron.findAll(options);

        return {totalCount: count, items: neurons};
    }

    public static async isDuplicate(idString: string, injectionId: string, id: string = null): Promise<boolean> {
        if (!injectionId || !idString) {
            return false;
        }

        const injection = await Injection.findByPk(injectionId);

        if (!injection) {
            return false;
        }

        const sample = await injection.getSample();

        if (!sample) {
            return false;
        }

        // Now get all injections for this sample.
        const injectionIds = (await Injection.findAll({where: {sampleId: sample.id}})).map((i: Injection) => i.id);

        if (injectionIds.length === 0) {
            return false;
        }

        // All neurons for sample (via injections) that have the same idString
        const dupes = await Neuron.findAll({where: {injectionId: {[Op.in]: injectionIds}, idString}});

        return dupes.length > 0 && (!id || (id !== dupes[0].id));
    }

    public static async isDuplicateNeuronObj(neuron: NeuronInput): Promise<boolean> {
        return Neuron.isDuplicate(neuron.idString, neuron.injectionId, neuron.id);
    }

    public static async createWith(neuronInput: NeuronInput): Promise<EntityMutateOutput<Neuron>> {
        try {
            const injection = await Injection.findByPk(neuronInput.injectionId);

            if (!injection) {
                return {source: null, error: "The injection can not be found"};
            }

            if (neuronInput.brainAreaId) {
                const brainArea = await BrainArea.findByPk(neuronInput
                    .brainAreaId);
                if (!brainArea) {
                    return {source: null, error: "The brain area can not be found"};
                }
            } else if (neuronInput.brainAreaId !== null) {
                // Zero-length string or undefined
                neuronInput.brainAreaId = null;
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
                sharing: 1,
                consensus: neuronInput.consensus || ConsensusStatus.None,
                brainAreaId: neuronInput.brainAreaId,
                injectionId: neuronInput.injectionId
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

            const injection = await row.getInjection();

            const isDupe = await Neuron.isDuplicate(neuronInput.idString || row.idString, neuronInput.injectionId || injection.id, row.id);

            if (isDupe) {
                return {source: null, error: `A neuron id "${neuronInput.idString}" already exists on this sample`};
            }

            // Undefined is ok (no update) - null, or empty is not - unless it is already that way from create
            if (this.isNullOrEmpty(neuronInput.idString) && row.idString) {
                return {source: null, error: "The idString cannot be empty"};
            } else if (neuronInput.idString !== undefined) {
                neuronInput.idString = neuronInput.idString.trim();
            }

            if (this.isNullOrEmpty(neuronInput.injectionId)) {
                return {source: null, error: "Injection id cannot be empty"};
            }

            if (neuronInput.injectionId) {
                const injection = await Injection.findByPk(neuronInput.injectionId);

                if (!injection) {
                    return {source: null, error: "The injection can not be found"};
                }
            }

            // Null is ok (inherited),  Undefined is ok (no change).  Id of length zero treated as null.  Otherwise, must
            // find brain area.
            if (neuronInput.brainAreaId) {
                const brainArea = await BrainArea.findByPk(neuronInput.brainAreaId);

                if (!brainArea) {
                    return {source: null, error: "The brain area can not be found"};
                }
            } else if (neuronInput.brainAreaId !== undefined && neuronInput.brainAreaId !== null) {
                // Zero-length string
                neuronInput.brainAreaId = null;
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

            if (neuronInput.sharing === null) {
                neuronInput.sharing = 1;
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
            const out = await swcApiClient.deleteTracingsForNeurons([id]);

            const errors = out.data.deleteTracingsForNeurons.filter(r => r.error !== null);

            if (errors.length > 0) {
                return {id, error: errors[0].error};
            }
        } catch (err) {
            return {
                id,
                error: "Could not reach the swc tracing server to verify or remove associated tracings"
            };
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

    public static async updateWithFile(upload: Promise<any>) {
        if (upload == null) {
            return {
                neurons: [],
                error: "ERROR: File not specified"
            }
        }

        const file = await upload;

        if (file == null) {
            return {
                neurons: [],
                error: "ERROR: File not specified"
            }
        }

        const stream = file.createReadStream();

        return new Promise((resolve) => {
            let buffer = "";

            stream.on("data", (buf) => {
                const str = buf.toString().trim();
                const lines = str.split(/\r?\n/g);
                lines.map(line => {
                    if (line.length > 0 && !line.startsWith("#")) {
                        buffer += line + "\n";
                    }
                });
            });

            stream.on("end", () => {
                console.log(buffer);

                parse(buffer.trim(), {columns: true, comment: "#", ltrim: true}, async (err, output) => {
                    if (err) {
                        resolve({
                            neurons: [],
                            error: "ERROR PARSING CSV" + err.toString()
                        });

                        return;
                    }

                    const neuronInputs: NeuronInput[] = await Promise.all<NeuronInput>(output.map(async (o): Promise<NeuronInput> => {
                        let neurons = await Neuron.findAll({where: {idString: o.idString.trim()}});

                        if (neurons.length > 0) {
                            return null;
                        }

                        let brainAreaId = await BrainArea.findId(o.brainArea) || await BrainArea.findIdWithAnyNameOrAcronym(o.brainArea) || null;

                        let injectionId = await Injection.findId(o.injectionUuid);

                        if (injectionId == null && o.sampleId.length > 0) {
                            let sampleId = await Sample.findId(o.sampleId) || await Sample.findIdWithIdNumber(o.sampleId) || null;

                            if (sampleId != null) {
                                let injections = await Injection.findAll({where: {sampleId}});

                                if (injections.length == 1) {
                                    injectionId = injections[0].id;
                                } else if (injections.length > 0) {
                                    // console.log(o);
                                    let injectionBrainAreaId = await BrainArea.findId(o.injectionBrainArea) || await BrainArea.findIdWithAnyNameOrAcronym(o.injectionBrainArea) || null;
                                    // console.log(o.idString + " " + injectionBrainAreaId);
                                    let fluorophoreId = await Fluorophore.findId(o.injectionFluorophore) || await Fluorophore.findIdWithName(o.injectionFluorophore) || null;
                                    // console.log(o.idString + " " + fluorophoreId);
                                    let virusId = await InjectionVirus.findId(o.injectionVirus) || await InjectionVirus.findIdWithName(o.injectionVirus) || null;
                                    // console.log(o.idString + " " + virusId);

                                    if (injectionBrainAreaId != null || fluorophoreId != null || virusId != null) {
                                        const where = {
                                            [Op.and]: {sampleId}
                                        };

                                        if (injectionBrainAreaId != null) {
                                            where[Op.and]["brainAreaId"] = injectionBrainAreaId;
                                        }

                                        if (fluorophoreId != null) {
                                            where[Op.and]["fluorophoreId"] = fluorophoreId;
                                        }

                                        if (virusId != null) {
                                            where[Op.and]["injectionVirusId"] = virusId;
                                        }

                                        injections = await Injection.findAll({where});

                                        if (injections.length == 1) {
                                            injectionId = injections[0].id;
                                        }
                                    }
                                }
                            }
                        }

                        if (injectionId == null) {
                            return null;
                        }

                        return {
                            idString: o.idString.trim(),
                            idNumber: 0,
                            tag: o.tag,
                            x: parseFloat(o.x),
                            y: parseFloat(o.y),
                            z: parseFloat(o.z),
                            injectionId,
                            brainAreaId
                        }
                    }));

                    const inputs = neuronInputs.filter(n => n != null);

                    if (inputs.length != neuronInputs.length) {
                        resolve({
                            neurons: [],
                            error: "ERROR: Some neurons could not be defined with the input - one or more injections not located correctly and/or one or more neurons has a duplicate idString"
                        });

                        return;
                    }

                    try {
                        const neurons = await Neuron.sequelize.transaction(async (t: Transaction) => {
                            // @ts-ignore
                            return Neuron.bulkCreate(neuronInputs);
                        });

                        resolve({
                            neurons: neurons,
                            error: null
                        });

                    } catch (error) {

                        resolve({
                            neurons: [],
                            error: "ERROR COMMITTING CHANGES" + error.toString()
                        });
                    }
                });
            });

            stream.read();
        });
    }

    public static async updateAnnotationMetadata(neuronId: string, upload: Promise<any>): Promise<IUpdateAnnotationOutput> {
        if (upload == null) {
            return {annotationMetadata: null, error: "ERROR: File not specified."};
        }

        const file = await upload;

        if (file == null) {
            return {annotationMetadata: null, error: "ERROR: File not specified."};
        }

        const neuron: Neuron = await Neuron.findByPk(neuronId);

        if (!neuron) {
            return {annotationMetadata: null, error: `ERROR: The neuron with id ${neuronId} could not be found.`};
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
                        neuron.metadata = data;
                    } else {
                        resolve({annotationMetadata: null, error: "ERROR: Could not parse annotation metadata."});
                    }
                } catch (error) {
                    resolve({annotationMetadata: null, error: "ERROR: Could not parse annotation metadata.\n" + error.toString()});
                }

                try {
                    neuron.save();
                } catch (error) {
                    resolve({annotationMetadata: null, error: "ERROR: Changes could not be committed.\n" + error.toString()});
                }

                resolve({annotationMetadata: buffer, error: null});
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
        sharing: {
            type: DataTypes.INTEGER,
            defaultValue: 1
        },
        doi: {
            type: DataTypes.TEXT
        },
        consensus: {
            type: DataTypes.INTEGER
        },
        annotationMetadata: {
            type: DataTypes.TEXT
        },
        metadata: {
            type: DataTypes.VIRTUAL,
            get: function (): IAnnotationMetadata {
                return JSON.parse(this.getDataValue("annotationMetadata")) || [];
            },
            set: function (value: IAnnotationMetadata) {
                this.setDataValue("annotationMetadata", JSON.stringify(value));
            }
        }
    }, {
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Neuron.belongsTo(Injection, {foreignKey: "injectionId"});
    Neuron.belongsTo(BrainArea, {foreignKey: {name: "brainAreaId", allowNull: true}});
};
