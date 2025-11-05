import { Sequelize, DataTypes} from "sequelize";

import {BaseModel} from "./baseModel";
import {NodeStructureTableName} from "./tableNames";

export enum NodeStructures {
    undefined = 0,
    soma = 1,
    axon = 2,
    basalDendrite = 3,
    apicalDendrite = 4,
    forkPoint = 5,
    endPoint = 6
}

export class NodeStructure extends BaseModel {
    public name: string;
    public swcValue: NodeStructures;

    public static valueIdMap = new Map<number, string>();
    public static idValueMap = new Map<string, number>();

    public static async loadCache()  {
        if (this.valueIdMap.size === 0) {
            const all = await NodeStructure.findAll({});
            all.forEach(s => {
                this.valueIdMap.set(s.swcValue, s.id);
                this.idValueMap.set(s.id, s.swcValue);
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

    public static countColumnName(s: number | string | NodeStructure): string {
        if (s === null || s === undefined) {
            return null;
        }

        let value: number;

        if (typeof s === "number") {
            value = s;
        } else if (typeof s === "string") {
            value = this.idValueMap.get(s);
        } else {
            value = s.swcValue;
        }

        if (value === null || value === undefined) {
            return null;
        }

        // Soma is not a count column.  It is defined by the neuron structure id.
        switch (value) {
            case NodeStructures.undefined:
                return "pathCount";
            case NodeStructures.forkPoint:
                return "branchCount";
            case  NodeStructures.endPoint:
                return "endCount";
        }

        return null;
    };
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return NodeStructure.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        name: DataTypes.TEXT,
        swcValue: DataTypes.INTEGER,
    }, {
        tableName: NodeStructureTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};
