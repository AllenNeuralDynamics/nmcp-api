import {Sequelize, DataTypes} from "sequelize";

import {BaseModel} from "./baseModel";
import {NeuronStructureTableName} from "./tableNames";
import {NodeStructures} from "./nodeStructure";

export class NeuronStructure extends BaseModel {
    public id: string;
    public name: string;

    private static _axonStructure: NeuronStructure = null;
    private static _dendriteStructure: NeuronStructure = null;
    private static _somaNeuronStructure: NeuronStructure = null;

    private static _swcValueMap = new Map<string, number>();

    public static get AxonStructureId(): string {
        return this._axonStructure?.id;
    }

    public static get DendriteStructureId(): string {
        return this._dendriteStructure?.id;
    }

    public static get SomaNeuronStructureId(): string {
        return this._somaNeuronStructure?.id;
    }

    public static async loadCache() {
        this._somaNeuronStructure = await this.findOne({where: {name: "soma"}});
        this._axonStructure = await this.findOne({where: {name: "axon"}});
        this._dendriteStructure = await this.findOne({where: {name: "dendrite"}});

        this._swcValueMap.set(this._somaNeuronStructure?.id, NodeStructures.soma);
        this._swcValueMap.set(this._axonStructure?.id, NodeStructures.axon);
        this._swcValueMap.set(this._dendriteStructure?.id, NodeStructures.basalDendrite);
    }

    public static swcStructureValue(id: string): number {
        // Returns the generic soma/axon/dendrite swc value rather than more specific fork/end options
        // that might be defined for internal nodes.
        return this._swcValueMap.get(id);
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
