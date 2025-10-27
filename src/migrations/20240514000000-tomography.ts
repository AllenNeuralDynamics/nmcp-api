import {QueryInterface} from "sequelize";

import {SpecimenTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(SpecimenTableName, "tomography", {
            type: Sequelize.TEXT
        });
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(SpecimenTableName, "tomography");
    }
}
