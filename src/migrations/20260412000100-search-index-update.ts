import {QueryInterface} from "sequelize";

import {SearchIndexTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(SearchIndexTableName, "canonicalDoi", {
            type: Sequelize.TEXT,
            defaultValue: null
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.removeColumn(SearchIndexTableName, "canonicalDoi");
    }
};
