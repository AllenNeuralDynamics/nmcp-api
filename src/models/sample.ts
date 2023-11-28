import {
    BelongsToGetAssociationMixin,
    DataTypes, FindOptions,
    HasManyGetAssociationsMixin,
    Sequelize
} from "sequelize";

import {
    BaseModel, DeleteOutput,
    EntityCount,
    EntityCountOutput, EntityMutateOutput,
    EntityQueryInput,
    EntityQueryOutput, EntityType,
    RawEntityCount
} from "./baseModel";
import {
    optionsWhereIds,
    optionsWhereMouseStrainIds,
    optionsWhereSampleIds, WithInjectionsQueryInput,
    WithMouseStrainQueryInput
} from "./findOptions";
import {MouseStrain} from "./mouseStrain";
import {Neuron} from "./neuron";
import {Injection} from "./injection";

export type SampleQueryInput =
    EntityQueryInput
    & WithMouseStrainQueryInput
    & WithInjectionsQueryInput;

export interface SampleInput {
    id: string,
    idNumber?: number;
    animalId?: string;
    tag?: string;
    comment?: string;
    sampleDate?: number;
    mouseStrainId?: string;
    mouseStrainName?: string;
    visibility?: number;
}

export class Sample extends BaseModel {
    public idNumber: number;
    public animalId: string;
    public tag: string;
    public comment: string;
    public sampleDate: Date;
    public visibility: number;

    public getMouseStrain!: BelongsToGetAssociationMixin<MouseStrain>;
    public getNeurons!: HasManyGetAssociationsMixin<Neuron>;
    public getInjections!: HasManyGetAssociationsMixin<Injection>;

    public readonly Injections?: Injection[];
    public readonly Neurons?: Neuron[];

    public static async findId(id: string): Promise<string> {
        return Sample.findIdWithValidationInternal(Sample, id);
    }

    public static async findIdWithIdNumber(sampleId: string): Promise<string> {
        const idNumber = parseInt(sampleId);

        if (!isNaN(idNumber)) {
            return (await Sample.findOne({where: {idNumber}}))?.id;
        }

        return null;
    }

    public static async getAll(input: SampleQueryInput): Promise<EntityQueryOutput<Sample>> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsWhereMouseStrainIds(input, options);

        const count = await this.setSortAndLimiting(options, input);

        const samples = await Sample.findAll(options);

        return {totalCount: count, items: samples};
    }

    public static async isDuplicate(sampleInput: SampleInput, id: string = null): Promise<boolean> {
        const dupes = await Sample.findAll({where: {idNumber: sampleInput.idNumber}});

        return dupes.length > 0 && (!id || (id !== dupes[0].id));
    }

    public static async createWith(sampleInput: SampleInput): Promise<EntityMutateOutput<Sample>> {
        try {
            if (sampleInput === undefined || sampleInput === null) {
                return {source: null, error: "Sample input object is required"};
            }

            let idNumber = sampleInput.idNumber;

            if (idNumber === undefined || idNumber === null) {
                const existing = (await Sample.findAll({
                    attributes: ["idNumber"],
                    order: [["idNumber", "DESC"]],
                    limit: 1
                })).map((o: Sample) => o.idNumber);

                if (existing.length > 0) {
                    idNumber = existing[0] + 1;
                } else {
                    idNumber = 1;
                }
            } else if (await Sample.isDuplicate(sampleInput)) {
                return {source: null, error: `The id number ${sampleInput.idNumber} has already been used`};
            }

            const sampleDate = sampleInput.sampleDate ? new Date(sampleInput.sampleDate) : new Date();
            const animalId = sampleInput.animalId || "";
            const tag = sampleInput.tag || "";
            const comment = sampleInput.comment || "";
            const mouseStrainId = sampleInput.mouseStrainId || null;
            const visibility = sampleInput.visibility || 0;

            const sample = await Sample.create({
                idNumber: idNumber,
                sampleDate: sampleDate,
                animalId: animalId,
                tag: tag,
                comment: comment,
                visibility: visibility,
                mouseStrainId: mouseStrainId
            });

            return {source: sample, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async updateWith(sampleInput: SampleInput): Promise<EntityMutateOutput<Sample>> {
        try {
            // Ok to be undefined (and not updated) - not ok to be null
            if ((sampleInput.idNumber === null) || sampleInput.idNumber && isNaN(sampleInput.idNumber)) {
                return {source: null, error: `The id number can not be empty`};
            }

            let row = await Sample.findByPk(sampleInput.id);

            if (!row) {
                return {source: null, error: "The sample could not be found"};
            }

            if (sampleInput.idNumber && await Sample.isDuplicate(sampleInput, sampleInput.id)) {
                return {source: null, error: `The id number ${sampleInput.idNumber} has already been used`};
            }

            // Ok to be undefined (and not updated) - not ok to be null
            if (sampleInput.animalId === null) {
                sampleInput.animalId = "";
            }

            if (sampleInput.tag === null) {
                sampleInput.tag = "";
            }

            if (sampleInput.comment === null) {
                sampleInput.comment = "";
            }

            if (sampleInput.visibility === null) {
                sampleInput.visibility = 0;
            }

            // Ok to be null.
            if (sampleInput.mouseStrainName) {
                const out = await MouseStrain.findOrCreateFromInput({
                    name: sampleInput.mouseStrainName
                });

                sampleInput.mouseStrainId = out.id;
            } else if (sampleInput.mouseStrainName === null) {
                sampleInput.mouseStrainId = null;
            }

            const sample = await row.update(sampleInput);

            return {source: sample, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async deleteFor(id: string): Promise<DeleteOutput> {
        try {
            if (!id || id.length === 0) {
                return {id, error: "id is a required input"};
            }

            const count = await Sample.destroy({where: {id}});

            if (count > 0) {
                return {id, error: null}
            }

            return {id, error: "The sample could not be found."};
        } catch (error) {
            return {id, error: error.message};
        }
    }

    public static async rawNeuronCounts(sampleIds: string[]): Promise<[RawEntityCount, EntityCount[]]> {
        let options: FindOptions = {
            attributes: ["sampleId", [Sequelize.fn("COUNT", "sampleId"), "sampleCount"]],
            group: ["sampleId"]
        };

        if (sampleIds && sampleIds.length > 0) {
            options = optionsWhereSampleIds({sampleIds}, options);
        }

        const neurons = await Neuron.findAll(options);
        const rawCounts = new Map<string, number>();
        const entityCounts: EntityCount[] = [];

        neurons.map((n: any) => {
            rawCounts.set(n.sampleId, parseInt(n.dataValues.sampleCount));
            entityCounts.push({id: n.sampleId, count: n.dataValues.sampleCount});
        });

        return [rawCounts, entityCounts];
    }

    public static async neuronCountsPerSample(sampleIds: string[]): Promise<EntityCountOutput> {
        try {
            const [, counts] = await this.rawNeuronCounts(sampleIds);

            return {
                entityType: EntityType.Sample,
                counts,
                error: null
            };
        } catch (err) {
            return {
                entityType: EntityType.Sample,
                counts: [],
                error: err
            }
        }
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Sample.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        idNumber: {
            type: DataTypes.INTEGER,
            defaultValue: -1
        },
        animalId: DataTypes.TEXT,
        tag: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        comment: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        sampleDate: DataTypes.DATE,
        visibility: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        }
    }, {
        tableName: "Sample",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Sample.belongsTo(MouseStrain, {foreignKey: "mouseStrainId"});
    Sample.hasMany(Neuron, {foreignKey: "sampleId"});
    Sample.hasMany(Injection, {foreignKey: "sampleId"});
};
