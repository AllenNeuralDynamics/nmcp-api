import {QueryInterface} from "sequelize";

import {AtlasQualityControlTableName, QualityControlTableName} from "../models/tableNames";

// Postgres keeps index and constraint names through a table rename.  The key and foreign key are the names
// 20251106000500-reconstruction's createTable gave them, and the index is the one Sequelize named for
// 20260909000000-phase-failure-columns - whose down removes it by that derived name, so down here must restore it.
const ConstraintRenames = [
    {from: "QualityControl_pkey", to: "AtlasQualityControl_pkey"},
    {from: "QualityControl_reconstructionId_fkey", to: "AtlasQualityControl_reconstructionId_fkey"}
];

const StatusIndexRename = {from: "quality_control_status", to: "atlas_quality_control_status"};

export = {
    // One transaction each way: migrate.sh retries until db:migrate succeeds, and a half-applied run would fail every
    // retry after it.
    up: async (queryInterface: QueryInterface) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.renameTable(QualityControlTableName, AtlasQualityControlTableName, {transaction});

            for (const rename of ConstraintRenames) {
                await queryInterface.sequelize.query(
                    `ALTER TABLE "${AtlasQualityControlTableName}" RENAME CONSTRAINT "${rename.from}" TO "${rename.to}";`,
                    {transaction}
                );
            }

            await queryInterface.sequelize.query(
                `ALTER INDEX "${StatusIndexRename.from}" RENAME TO "${StatusIndexRename.to}";`,
                {transaction}
            );
        });
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.sequelize.query(
                `ALTER INDEX "${StatusIndexRename.to}" RENAME TO "${StatusIndexRename.from}";`,
                {transaction}
            );

            for (const rename of [...ConstraintRenames].reverse()) {
                await queryInterface.sequelize.query(
                    `ALTER TABLE "${AtlasQualityControlTableName}" RENAME CONSTRAINT "${rename.to}" TO "${rename.from}";`,
                    {transaction}
                );
            }

            await queryInterface.renameTable(AtlasQualityControlTableName, QualityControlTableName, {transaction});
        });
    }
};
