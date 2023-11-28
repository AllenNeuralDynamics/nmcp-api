import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, Sequelize} from "sequelize";

import {
    BaseModel,
    DeleteOutput,
    EntityCount,
    EntityCountOutput, EntityMutateOutput,
    EntityQueryInput,
    EntityType,
    RawEntityCount
} from "./baseModel";
import {BrainArea} from "./brainArea";
import {Sample} from "./sample";
import {InjectionVirus} from "./injectionVirus";
import {Fluorophore} from "./fluorophore";
import {Neuron} from "./neuron";
import {
    optionsIncludeNeuronIds,
    optionsWhereCompartmentIds,
    optionsWhereFluorophoreIds,
    optionsWhereIds, optionsWhereInjectionIds,
    optionsWhereInjectionVirusIds,
    optionsWhereSampleIds,
    WithCompartmentQueryInput,
    WithFluorophoreQueryInput,
    WithInjectionVirusQueryInput,
    WithNeuronsQueryInput,
    WithSamplesQueryInput
} from "./findOptions";

export type InjectionQueryInput =
    EntityQueryInput
    & WithNeuronsQueryInput
    & WithSamplesQueryInput
    & WithFluorophoreQueryInput
    & WithInjectionVirusQueryInput
    & WithCompartmentQueryInput;

export interface InjectionInput {
    id?: string;
    brainAreaId?: string;
    injectionVirusId?: string;
    injectionVirusName?: string;
    fluorophoreId?: string;
    fluorophoreName?: string;
    sampleId?: string;
}

export class Injection extends BaseModel {
    public getSample!: BelongsToGetAssociationMixin<Sample>;
    public getBrainArea!: BelongsToGetAssociationMixin<BrainArea>;
    public getInjectionVirus!: BelongsToGetAssociationMixin<InjectionVirus>;
    public getFluorophore!: BelongsToGetAssociationMixin<Fluorophore>;
    public getNeurons!: HasManyGetAssociationsMixin<Neuron>;

    public readonly sample?: Sample;

    public static async findId(id: string): Promise<string> {
        return Injection.findIdWithValidationInternal(Injection, id);
    }

    public static async getAll(input: InjectionQueryInput): Promise<Injection[]> {
        let options: FindOptions = optionsWhereIds(input, {where: null, include: []});

        options = optionsIncludeNeuronIds(input, options);
        options = optionsWhereSampleIds(input, options);
        options = optionsWhereInjectionVirusIds(input, options);
        options = optionsWhereFluorophoreIds(input, options);
        options = optionsWhereCompartmentIds(input, options);

        await this.setSortAndLimiting(options, input);

        return Injection.findAll(options);
    }

    /**
     * A given sample can have one injection per brain area/compartment.
     * @param injectionInput
     * @returns {Promise<Injection>}
     */
    public static async findDuplicate(injectionInput: InjectionInput): Promise<Injection> {
        if (!injectionInput || !injectionInput.sampleId || !injectionInput.brainAreaId) {
            return null;
        }

        return Injection.findOne({
            where: {
                sampleId: injectionInput.sampleId,
                brainAreaId: injectionInput.brainAreaId
            }
        });
    }

    public static async createWith(injectionInput: InjectionInput): Promise<EntityMutateOutput<Injection>> {
        try {
            if (!injectionInput) {
                return {source: null, error: "Injection properties are a required input"};
            }

            if (!injectionInput.sampleId) {
                return {source: null, error: "Sample is a required input"};
            }

            if (!injectionInput.brainAreaId) {
                return {source: null, error: "Brain area is a required input"};
            }

            let injectionVirusId = null;

            if (injectionInput.injectionVirusName) {
                const out = await InjectionVirus.findOrCreateFromInput({
                    name: injectionInput.injectionVirusName
                });

                injectionVirusId = out.id;
            } else {
                injectionVirusId = injectionInput.injectionVirusId;
            }

            if (!injectionVirusId) {
                return {source: null, error: "Injection virus is a required input"};
            }

            let fluorophoreId = null;

            if (injectionInput.fluorophoreName) {
                const out = await Fluorophore.findOrCreateFromInput({
                    name: injectionInput.fluorophoreName
                });

                fluorophoreId = out.id;
            } else {
                fluorophoreId = injectionInput.fluorophoreId;
            }

            if (!fluorophoreId) {
                return {source: null, error: "Fluorophore is a required input"};
            }

            const injection = await Injection.create({
                sampleId: injectionInput.sampleId,
                brainAreaId: injectionInput.brainAreaId,
                injectionVirusId: injectionVirusId,
                fluorophoreId: fluorophoreId
            });

            return {source: injection, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async updateWith(injectionInput: InjectionInput): Promise<EntityMutateOutput<Injection>> {
        try {
            if (!injectionInput) {
                return {source: null, error: "Injection properties are a required input"};
            }

            if (!injectionInput.id) {
                return {source: null, error: "Injection input must contain the id of the object to update"};
            }

            let row = await Injection.findByPk(injectionInput.id);

            if (!row) {
                return {source: null, error: "The injection could not be found"};
            }

            // Undefined is ok (i.e., no update), null/empty is not allowed
            if (this.isNullOrEmpty(injectionInput.sampleId)) {
                return {source: null, error: "Sample id must be a valid sample"};
            }

            if (this.isNullOrEmpty(injectionInput.brainAreaId)) {
                return {source: null, error: "Brain compartment id must be a valid sample"};
            }

            if (this.isNullOrEmpty(injectionInput.injectionVirusId)) {
                return {source: null, error: "Injection virus id must be a valid sample"};
            }

            if (this.isNullOrEmpty(injectionInput.fluorophoreId)) {
                return {source: null, error: "Fluorophore id must be a valid sample"};
            }

            const merged = Object.assign(row, injectionInput);

            const duplicate = await Injection.findDuplicate(merged);

            if (duplicate && duplicate.id !== injectionInput.id) {
                return {source: null, error: `This sample already contains an injection in this brain compartment`};
            }

            if (injectionInput.injectionVirusName) {
                const out = await InjectionVirus.findOrCreateFromInput({
                    name: injectionInput.injectionVirusName
                });

                injectionInput.injectionVirusId = out.id;
            }

            if (injectionInput.fluorophoreName) {
                const out = await Fluorophore.findOrCreateFromInput({
                    name: injectionInput.fluorophoreName
                });

                injectionInput.fluorophoreId = out.id;
            }

            const injection = await row.update(injectionInput);

            return {source: injection, error: null};
        } catch (error) {
            return {source: null, error: error.message};
        }
    }

    public static async deleteFor(id: string): Promise<DeleteOutput> {
        try {
            if (!id || id.length === 0) {
                return {id, error: "id is a required input"};
            }

            const count = await Injection.destroy({where: {id}});

            if (count > 0) {
                return {id, error: null}
            }

            return {id, error: "The injection could not be found."};
        } catch (error) {
            return {id, error: error.message};
        }
    }

    public static async rawNeuronCountsPerInjection(injectionIds: string[]): Promise<[RawEntityCount, EntityCount[]]> {
        let options: FindOptions = {
            attributes: ["injectionId", [Sequelize.fn("COUNT", "injectionId"), "injectionCount"]],
            group: ["injectionId"]
        };

        if (injectionIds && injectionIds.length > 0) {
            options = optionsWhereInjectionIds({injectionIds}, options);
        }

        const neurons = await Neuron.findAll(options);

        const rawCounts = new Map<string, number>();
        const entityCounts: EntityCount[] = [];

        neurons.map((n: any) => {
            rawCounts.set(n.injectionId, parseInt(n.dataValues.injectionCount));
            entityCounts.push({id: n.injectionId, count: n.dataValues.injectionCount});
        });

        return [rawCounts, entityCounts];
    }

    public static async neuronCountPerInjection(ids: string[]): Promise<EntityCountOutput> {
        try {
            const [, counts] = await this.rawNeuronCountsPerInjection(ids);

            return {
                entityType: EntityType.Injection,
                counts,
                error: null
            };
        } catch (err) {
            return {
                entityType: EntityType.Injection,
                counts: [],
                error: err
            }
        }
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Injection.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        }
    }, {
        tableName: "Injection",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Injection.belongsTo(Sample, {foreignKey: "sampleId"});
    Injection.belongsTo(BrainArea, {foreignKey: "brainAreaId"});
    Injection.belongsTo(InjectionVirus, {foreignKey: "injectionVirusId"});
    Injection.belongsTo(Fluorophore, {foreignKey: "fluorophoreId"});
};
