import {QueryInterface} from "sequelize";

import {IssueTableName} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(IssueTableName,
            "responderId", {
                type: Sequelize.UUID,
                allowNull: true
            },
        );
    },

    down: async (queryInterface: QueryInterface, _: any) => {
        await queryInterface.removeColumn(IssueTableName, "responderId");
    }
}
