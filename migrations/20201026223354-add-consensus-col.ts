const NeuronTableName = "Neurons";

export = {
    up: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.addColumn(NeuronTableName, "consensus", {
            type: Sequelize.INTEGER,
            defaultValue: 0
        });

        await queryInterface.addIndex(NeuronTableName, ["consensus"]);
    },

    down: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.dropTable(NeuronTableName);
    }
};
