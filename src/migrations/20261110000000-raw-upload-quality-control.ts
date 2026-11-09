import {QueryInterface} from "sequelize";

import {RawReconstructionUploadTableName} from "../models/tableNames";

export = {
    // One transaction each way: migrate.sh retries until db:migrate succeeds, and a half-applied run would fail every
    // retry after it.
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.addColumn(RawReconstructionUploadTableName, "qcTag", {type: Sequelize.UUID, allowNull: true, defaultValue: null}, {transaction});
            await queryInterface.addColumn(RawReconstructionUploadTableName, "skeletonId", {type: Sequelize.INTEGER, allowNull: true, defaultValue: null}, {transaction});
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.removeColumn(RawReconstructionUploadTableName, "skeletonId", {transaction});
            await queryInterface.removeColumn(RawReconstructionUploadTableName, "qcTag", {transaction});
        });
    }
};
