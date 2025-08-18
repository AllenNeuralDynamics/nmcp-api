import {QueryInterface} from "sequelize";

import {NeuronTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(NeuronTableName,
            "somaProperties", {
                type: Sequelize.JSONB,
                allowNull: true,
            },
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(NeuronTableName, "somaProperties");
    }
}
