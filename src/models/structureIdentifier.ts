import { Sequelize, DataTypes, HasManyGetAssociationsMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {TracingNode} from "./tracingNode";

export enum StructureIdentifiers {
    undefined = 0,
    soma = 1,
    axon = 2,
    basalDendrite = 3,
    apicalDendrite = 4,
    forkPoint = 5,
    endPoint = 6
}

export class StructureIdentifier extends BaseModel {
    public name: string;
    public value: StructureIdentifiers;
    public mutable: boolean;

    public getNodes!: HasManyGetAssociationsMixin<TracingNode>;

    public static valueIdMap = new Map<number, string>();
    public static idValueMap = new Map<string, number>();

    public static async buildIdValueMap()  {
        if (this.valueIdMap.size === 0) {
            const all = await StructureIdentifier.findAll({});
            all.forEach(s => {
                this.valueIdMap.set(s.value, s.id);
                this.idValueMap.set(s.id, s.value);
            });
        }
    }

    public static idForValue(val: number) {
        return this.valueIdMap.get(val);
    }

    public static valueForId(id: string) {
        return this.idValueMap.get(id);
    }

    public static structuresAreLoaded () {
        return this.valueIdMap.size > 0;
    }
}

export const modelInit = (sequelize: Sequelize) => {
    StructureIdentifier.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        name: DataTypes.TEXT,
        value: DataTypes.INTEGER,
        mutable: {type: DataTypes.BOOLEAN, defaultValue: true}
    }, {
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    StructureIdentifier.hasMany(TracingNode, {foreignKey: "structureIdentifierId", as: "Nodes"});

    StructureIdentifier.buildIdValueMap().then();
};
