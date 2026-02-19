import {QueryInterface} from "sequelize";

import {SpecimenTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(SpecimenTableName, "referenceDataset", {
            type: Sequelize.JSONB,
            defaultValue: null
        });
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(SpecimenTableName, "referenceDataset");
    }
}
