import {Sequelize, DataTypes} from "sequelize";

import {BaseModel} from "./baseModel";
import {NeuronStructureTableName} from "./tableNames";

export class NeuronStructure extends BaseModel {
    public id: string;
    public name: string;

    private static _axonStructure: NeuronStructure = null;
    private static _dendriteStructure: NeuronStructure = null;
    private static _somaNeuronStructure: NeuronStructure = null;

    public static get AxonStructureId(): string {
        return this._axonStructure.id;
    }

    public static get DendriteStructureId(): string {
        return this._dendriteStructure.id;
    }

    public static get SomaNeuronStructureId(): string {
        return this._somaNeuronStructure.id;
    }

    public static async loadCache() {
        this._axonStructure = await this.findOne({where: {name: "axon"}});
        this._dendriteStructure = await this.findOne({where: {name: "dendrite"}});
        this._somaNeuronStructure = await this.findOne({where: {name: "soma"}});
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return NeuronStructure.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        name: DataTypes.TEXT
    }, {
        tableName: NeuronStructureTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};
