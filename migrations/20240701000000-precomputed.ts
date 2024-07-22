import {QueryInterface} from "sequelize";

import {
    SampleTableName,
    NeuronTableName,
    SearchContentTable,
    PrecomputedTableName,
    ReconstructionTableName,
    SynchronizationMarkerTableName
} from "./src/TableNames";

export = {
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        try {
            await queryInterface.removeColumn(SampleTableName, "visibility");
            await queryInterface.removeColumn(NeuronTableName, "visibility");
            await queryInterface.removeColumn(SearchContentTable, "visibility");
        } catch (err){
            console.log(err)
        }

        await queryInterface.createTable(
            PrecomputedTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                skeletonSegmentId: {
                    type: Sequelize.INTEGER,
                    autoIncrement: true,
                    allowNull: false,
                    unique: true
                },
                version: Sequelize.INTEGER,
                reconstructionId: {
                    type: Sequelize.UUID,
                    references: {
                        model: ReconstructionTableName,
                        key: "id"
                    }
                },
                generatedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.addColumn(SampleTableName, "visibility", {
            type: Sequelize.INTEGER,
            defaultValue: 0
        });
        await queryInterface.addColumn(SampleTableName, "visibility", {
            type: Sequelize.INTEGER,
            defaultValue: 0
        });
        await queryInterface.addColumn(SearchContentTable, "visibility", {
            type: Sequelize.INTEGER,
            defaultValue: 0
        });
        await queryInterface.dropTable(PrecomputedTableName);
    }
}
