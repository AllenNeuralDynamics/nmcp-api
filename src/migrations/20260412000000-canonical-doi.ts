import {QueryInterface} from "sequelize";

import {NeuronTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(NeuronTableName, "canonicalDoi", {
            type: Sequelize.TEXT,
            defaultValue: null
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.removeColumn(NeuronTableName, "canonicalDoi");
    }
};
