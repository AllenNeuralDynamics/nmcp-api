import {QueryInterface} from "sequelize";

import {ReconstructionTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(ReconstructionTableName,
            "qualityCheckStatus", {
                type: Sequelize.INTEGER,
                defaultValue: 0
            }
        );
        await queryInterface.addColumn(ReconstructionTableName,
            "qualityCheckVersion", Sequelize.TEXT
        );
        await queryInterface.addColumn(ReconstructionTableName,
            "qualityCheck", {
                type: Sequelize.JSONB,
                allowNull: true,
            },
        );
        await queryInterface.addColumn(ReconstructionTableName,
            "qualityCheckAt", Sequelize.DATE
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(ReconstructionTableName, "qualityCheckStatus")
        await queryInterface.removeColumn(ReconstructionTableName, "qualityCheckVersion");
        await queryInterface.removeColumn(ReconstructionTableName, "qualityCheck");
        await queryInterface.removeColumn(ReconstructionTableName, "qualityCheckAt");
    }
}
