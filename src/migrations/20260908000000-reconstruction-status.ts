 import {QueryInterface} from "sequelize";

import {ReconstructionTableName} from "../models/tableNames";

// Raw SQL rather than changeColumn: the column keeps its type and only the default and nullability change.  The
// default was 0, which is no longer a ReconstructionStatus member, so a creation path that omits a status has to fail
// rather than be handed one that means nothing.
const dropDefaultQuery = `ALTER TABLE "${ReconstructionTableName}" ALTER COLUMN "status" DROP DEFAULT;`;
const setNotNullQuery = `ALTER TABLE "${ReconstructionTableName}" ALTER COLUMN "status" SET NOT NULL;`;

const restoreDefaultQuery = `ALTER TABLE "${ReconstructionTableName}" ALTER COLUMN "status" SET DEFAULT 0;`;
const dropNotNullQuery = `ALTER TABLE "${ReconstructionTableName}" ALTER COLUMN "status" DROP NOT NULL;`;

export = {
    up: async (queryInterface: QueryInterface) => {
        await queryInterface.sequelize.query(dropDefaultQuery);

        // No backfill: nothing was ever written at the removed Initialized status.  A row holding one anyway makes this
        // fail with Postgres naming the column, which is the outcome to want.
        await queryInterface.sequelize.query(setNotNullQuery);
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.sequelize.query(dropNotNullQuery);

        await queryInterface.sequelize.query(restoreDefaultQuery);
    }
};
