import {QueryInterface} from "sequelize";

import {ReconstructionTableName, UserTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(ReconstructionTableName, "teamReviewerId", {
            type: Sequelize.UUID,
            references: {
                model: UserTableName,
                key: "id"
            }
        });

        await queryInterface.addColumn(ReconstructionTableName, "teamReviewedAt", {
            type: Sequelize.DATE,
            defaultValue: null
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.removeColumn(ReconstructionTableName, "teamReviewedAt");

        await queryInterface.removeColumn(ReconstructionTableName, "teamReviewerId");
    }
};
