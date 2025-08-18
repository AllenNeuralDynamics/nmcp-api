import {QueryInterface} from "sequelize";

import {SampleTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(SampleTableName, "tomography", {
            type: Sequelize.TEXT
        });
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(SampleTableName, "tomography");
    }
}
