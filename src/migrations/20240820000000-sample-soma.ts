import {QueryInterface} from "sequelize";

import {NeuronTableName} from "../models/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(NeuronTableName,
            "sampleX", {
                type: Sequelize.DOUBLE,
                defaultValue: 0
            },
        );
        await queryInterface.addColumn(NeuronTableName,
            "sampleY", {
                type: Sequelize.DOUBLE,
                defaultValue: 0
            },
        );
        await queryInterface.addColumn(NeuronTableName,
            "sampleZ", {
                type: Sequelize.DOUBLE,
                defaultValue: 0
            },
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(NeuronTableName, "sampleX");
        await queryInterface.removeColumn(NeuronTableName, "sampleY");
        await queryInterface.removeColumn(NeuronTableName, "sampleZ");
    }
}
