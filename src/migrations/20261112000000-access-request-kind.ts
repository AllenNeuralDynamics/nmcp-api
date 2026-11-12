import {QueryInterface} from "sequelize";

import {AccessRequestTableName} from "../models/tableNames";

export = {
    // Postgres fills the existing rows with the column default as part of the ALTER, so no separate backfill is needed.
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(AccessRequestTableName, "requestKind", {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0                                 // AccessRequestKind.Access
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.removeColumn(AccessRequestTableName, "requestKind");
    }
};
