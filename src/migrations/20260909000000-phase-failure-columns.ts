import {QueryInterface} from "sequelize";

import {AtlasReconstructionTableName, QualityControlTableName} from "../models/tableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(AtlasReconstructionTableName, "failureReason", {
            type: Sequelize.TEXT,
            defaultValue: null
        });

        await queryInterface.addColumn(AtlasReconstructionTableName, "failedAt", {
            type: Sequelize.DATE,
            defaultValue: null
        });

        // The atlas reconstruction table already has one (20251106000500-reconstruction.ts:408); this table never
        // got one, and both QualityControl.getPending and the per-pass claim sweep select on status.
        await queryInterface.addIndex(QualityControlTableName, ["status"]);
    },

    down: async (queryInterface: QueryInterface) => {
        await queryInterface.removeIndex(QualityControlTableName, ["status"]);

        await queryInterface.removeColumn(AtlasReconstructionTableName, "failedAt");

        await queryInterface.removeColumn(AtlasReconstructionTableName, "failureReason");
    }
};
