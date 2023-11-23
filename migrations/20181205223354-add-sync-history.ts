const SyncHistoryTableName = "SyncHistory";

export = {
    up: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.createTable(
            SyncHistoryTableName,
            {
                id: {
                    primaryKey: true,
                    type: Sequelize.UUID,
                    defaultValue: Sequelize.UUIDV4
                },
                kind: Sequelize.INTEGER,
                entity: Sequelize.UUID,
                status: Sequelize.INTEGER,
                error: Sequelize.TEXT,
                startedAt:Sequelize.DATE,
                completedAt: Sequelize.DATE,
                createdAt: Sequelize.DATE,
                updatedAt: Sequelize.DATE,
                deletedAt: Sequelize.DATE
            });

        await queryInterface.addIndex(SyncHistoryTableName, ["kind"]);
    },

    down: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.dropTable(SyncHistoryTableName);
    }
};
