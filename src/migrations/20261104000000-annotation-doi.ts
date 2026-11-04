import {QueryInterface, QueryTypes} from "sequelize";

import {AnnotationTableName, AtlasReconstructionTableName} from "../models/tableNames";

const UniqueAnnotationIndexName = "atlas_reconstruction_annotation_id";

export = {
    // One transaction each way: migrate.sh retries until db:migrate succeeds, and a half-applied run would fail every
    // retry after it.
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            // Raw SQL bypasses the paranoid scope, so soft-deleted rows count toward the one-to-one check too.
            const duplicated = await queryInterface.sequelize.query<{ annotationId: string }>(`
                SELECT "annotationId" FROM "${AtlasReconstructionTableName}"
                WHERE "annotationId" IS NOT NULL
                GROUP BY "annotationId"
                HAVING COUNT(*) > 1;
            `, {type: QueryTypes.SELECT, transaction});

            const unparented = await queryInterface.sequelize.query<{ id: string }>(`
                SELECT "id" FROM "${AtlasReconstructionTableName}" WHERE "annotationId" IS NULL;
            `, {type: QueryTypes.SELECT, transaction});

            if (duplicated.length > 0 || unparented.length > 0) {
                throw new Error("Cannot make AtlasReconstruction one-to-one with Annotation - "
                    + `annotations with more than one atlas row: ${duplicated.map(row => row.annotationId).join(", ") || "none"}; `
                    + `atlas rows with no annotation: ${unparented.map(row => row.id).join(", ") || "none"} - resolve these before migrating.`);
            }

            await queryInterface.addColumn(AnnotationTableName, "doi", {type: Sequelize.TEXT, defaultValue: ""}, {transaction});

            await queryInterface.sequelize.query(`
                UPDATE "${AnnotationTableName}" AS annotation
                SET "doi" = atlas."doi"
                FROM "${AtlasReconstructionTableName}" AS atlas
                WHERE atlas."annotationId" = annotation."id";
            `, {transaction});

            await queryInterface.removeColumn(AtlasReconstructionTableName, "doi", {transaction});

            // Raw SQL rather than changeColumn: on Postgres, changeColumn with references adds a second foreign key.
            await queryInterface.sequelize.query(`
                ALTER TABLE "${AtlasReconstructionTableName}" ALTER COLUMN "annotationId" SET NOT NULL;
            `, {transaction});

            await queryInterface.addIndex(AtlasReconstructionTableName, ["annotationId"], {name: UniqueAnnotationIndexName, unique: true, transaction});
        });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.removeIndex(AtlasReconstructionTableName, UniqueAnnotationIndexName, {transaction});

            await queryInterface.sequelize.query(`
                ALTER TABLE "${AtlasReconstructionTableName}" ALTER COLUMN "annotationId" DROP NOT NULL;
            `, {transaction});

            await queryInterface.addColumn(AtlasReconstructionTableName, "doi", {type: Sequelize.TEXT, defaultValue: ""}, {transaction});

            await queryInterface.sequelize.query(`
                UPDATE "${AtlasReconstructionTableName}" AS atlas
                SET "doi" = annotation."doi"
                FROM "${AnnotationTableName}" AS annotation
                WHERE atlas."annotationId" = annotation."id";
            `, {transaction});

            await queryInterface.removeColumn(AnnotationTableName, "doi", {transaction});
        });
    }
};
