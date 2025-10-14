import {QueryInterface} from "sequelize";

import {ReconstructionTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(ReconstructionTableName,
            "doi", {
                type: Sequelize.TEXT,
                defaultValue: 0
            }
        );
        await queryInterface.addColumn(ReconstructionTableName,
            "archivedAt", Sequelize.DATE
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(ReconstructionTableName, "doi")
        await queryInterface.removeColumn(ReconstructionTableName, "archivedAt")
    }
}
