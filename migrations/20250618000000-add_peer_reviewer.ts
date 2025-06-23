import {QueryInterface} from "sequelize";

import {ReconstructionTableName, UserTableName} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(ReconstructionTableName,
            "peerReviewerId", {
                type: Sequelize.UUID,
                references: {
                    model: UserTableName,
                    key: "id"
                }
            },
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(ReconstructionTableName, "peerReviewerId");
    }
}
