const NeuronTableName = "Neurons";

export = {
    up: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.addColumn(NeuronTableName, "annotationMetadata", {
            type: Sequelize.TEXT
        });
    },

    down: async (queryInterface: any, Sequelize: any) => {
        await queryInterface.dropTable(NeuronTableName);
    }
};
