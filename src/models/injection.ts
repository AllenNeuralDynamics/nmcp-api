import {BelongsToGetAssociationMixin, DataTypes, Sequelize} from "sequelize";

import {InjectionTableName} from "./tableNames";
import {BaseModel} from "./baseModel";
import {optionsWhereSpecimenIds, WithSpecimensQueryInput} from "./findOptions";
import {Specimen} from "./specimen";
import {AtlasStructure} from "./atlasStructure";
import {InjectionVirus} from "./injectionVirus";
import {Fluorophore} from "./fluorophore";
import {User} from "./user";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {isNullOrEmpty} from "../util/objectUtil";

export type InjectionQueryInput = WithSpecimensQueryInput;

export type InjectionShape = {
    id?: string;
    specimenId?: string;
    atlasStructureId?: string;
    injectionVirusId?: string;
    injectionVirusName?: string;
    fluorophoreId?: string;
    fluorophoreName?: string;
}

export class Injection extends BaseModel {
    public specimenId: string;
    public atlasStructureId: string;

    public getSpecimen!: BelongsToGetAssociationMixin<Specimen>;
    public getAtlasStructure!: BelongsToGetAssociationMixin<AtlasStructure>;
    public getInjectionVirus!: BelongsToGetAssociationMixin<InjectionVirus>;
    public getFluorophore!: BelongsToGetAssociationMixin<Fluorophore>;

    public readonly Specimen?: Specimen;
    public readonly InjectionVirus?: InjectionVirus;
    public readonly Fluorophore?: Fluorophore;

    public static async getAll(input: InjectionQueryInput): Promise<Injection[]> {
        const options = optionsWhereSpecimenIds(input, {where: null, include: []});

        return Injection.findAll(options);
    }

    /**
     * A given specimen can have one injection per atlas structure.
     */
    private static async findDuplicate(specimenId: string, atlasStructureId: string): Promise<Injection> {
        return Injection.findOne({
            where: {
                specimenId: specimenId,
                atlasStructureId: atlasStructureId
            }
        });
    }

    private async findInstanceDuplicate(specimenId: string, atlasStructureId: string): Promise<Injection> {
        return Injection.findDuplicate(specimenId ?? this.specimenId, atlasStructureId ?? this.atlasStructureId);
    }

    public static async createForShape(user: User, shape: InjectionShape): Promise<Injection> {
        const duplicate = await this.findDuplicate(shape.specimenId, shape.atlasStructureId);

        if (duplicate) {
            throw new Error("This specimen already contains an injection in this atlas structure.");
        }

        return await this.sequelize.transaction(async (t) => {
            if (shape.injectionVirusName) {
                const out = await InjectionVirus.findOrCreateFromName(user, shape.injectionVirusName, shape.specimenId, t);
                shape.injectionVirusId = out.id;
            } else {
                throw new Error("Injection virus is a required input.");
            }

            if (shape.fluorophoreName) {
                const out = await Fluorophore.findOrCreateFromName(user, shape.fluorophoreName, shape.specimenId, t);
                shape.fluorophoreId = out.id;
            } else {
                throw new Error("Fluorophore virus is a required input.");
            }

            const injection = await Injection.create(shape, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.InjectionCreate,
                targetId: injection.id,
                parentId: shape.specimenId,
                details: shape,
                userId: user.id
            }, t);

            return injection;
        });
    }

    public async updateForShape(user: User, shape: InjectionShape): Promise<Injection> {
        const duplicate = await this.findInstanceDuplicate(shape.specimenId, shape.atlasStructureId);

        if (duplicate && duplicate.id !== shape.id) {
            throw new Error("This specimen already contains an injection in this atlas structure.");
        }

        return await this.sequelize.transaction(async (t) => {
            if (shape.injectionVirusName) {
                const out = await InjectionVirus.findOrCreateFromName(user, shape.injectionVirusName, this.specimenId, t);
                shape.injectionVirusId = out.id;
            }

            if (shape.fluorophoreName) {
                const out = await Fluorophore.findOrCreateFromName(user, shape.fluorophoreName, this.specimenId, t);
                shape.fluorophoreId = out.id;
            }

            const injection = await this.update(shape, {transaction: t});

            await recordEvent({
                kind: EventLogItemKind.InjectionUpdate,
                targetId: injection.id,
                parentId: injection.specimenId,
                details: shape,
                userId: user.id
            }, t);

            return injection;
        });
    }

    public static async createOrUpdateForShape(user: User, shape: InjectionShape, allowCreate: boolean): Promise<Injection> {
        if (!user?.canEditSpecimens()) {
            throw new UnauthorizedError();
        }

        // Undefined is ok (i.e., no update), null/empty is not allowed
        if (isNullOrEmpty(shape.specimenId)) {
            throw new Error("Specimen id must be a valid specimen.");
        }

        // Undefined is ok (i.e., no update), null/empty is not allowed
        if (isNullOrEmpty(shape.atlasStructureId)) {
            throw new Error("Atlas structure id must be a valid structure.");
        }

        let injection: Injection;

        if (shape.id) {
            injection = await Injection.findByPk(shape.id);
        }

        if (!injection) {
            if (allowCreate) {
                return this.createForShape(user, shape);
            }
            return null;
        }

        return injection.updateForShape(user, shape);

    }

    public static async deleteByPk(user: User, id: string): Promise<string> {
        if (!user?.canEditSpecimens()) {
            throw new UnauthorizedError();
        }

        if (!id || id.length === 0) {
            throw new Error("Injection id is a required argument");
        }

        return await Injection.sequelize.transaction(async (t) => {
            const injection = await Injection.findByPk(id, {attributes: ["id", "specimenId"]});
            const count = await Injection.destroy({where: {id}});

            if (count > 0) {
                await recordEvent({
                    kind: EventLogItemKind.InjectionDelete,
                    targetId: id,
                    parentId: injection?.specimenId ?? null,
                    userId: user.id
                }, t);

                return id;
            }

            await t.rollback();

            throw new Error(`The injection could not be removed.  Verify ${id} is a valid injection id.`);
        });
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Injection.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        }
    }, {
        tableName: InjectionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Injection.belongsTo(Specimen, {foreignKey: "specimenId"});
    Injection.belongsTo(AtlasStructure, {foreignKey: "atlasStructureId", as: "AtlasStructure"});
    Injection.belongsTo(InjectionVirus, {foreignKey: "injectionVirusId"});
    Injection.belongsTo(Fluorophore, {foreignKey: "fluorophoreId"});
};
