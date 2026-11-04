import {QueryInterface, Transaction} from "sequelize";

import {
    AnnotationTableName,
    AtlasReconstructionTableName,
    ReconstructionTableName,
    SpecimenNodeTableName,
    SpecimenSpacePrecomputedTableName,
    SpecimenSpaceReconstructionTableName
} from "../models/tableNames";

const dropForeignKey = async (queryInterface: QueryInterface, table: string, referencedTable: string, transaction: Transaction): Promise<void> => {
    const references = await queryInterface.getForeignKeyReferencesForTable(table, {transaction}) as any[];

    const matches = references.filter(reference => reference.columnName === "reconstructionId" && reference.referencedTableName === referencedTable);

    if (matches.length !== 1) {
        throw new Error(`Expected one reconstructionId foreign key from ${table} to ${referencedTable}, found ${matches.length}.`);
    }

    await queryInterface.removeConstraint(table, matches[0].constraintName, {transaction});
};

const addForeignKey = async (queryInterface: QueryInterface, table: string, referencedTable: string, transaction: Transaction): Promise<void> => {
    await queryInterface.addConstraint(table, {
        fields: ["reconstructionId"],
        type: "foreign key",
        references: {table: referencedTable, field: "id"},
        onDelete: "NO ACTION",
        onUpdate: "NO ACTION",
        transaction
    });
};

const SpecimenDataChildTables = [SpecimenNodeTableName, SpecimenSpacePrecomputedTableName];

export = {
    // One transaction each way: migrate.sh retries until db:migrate succeeds, and a half-applied run would fail every
    // retry after it.
    up: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.renameTable(ReconstructionTableName, AnnotationTableName, {transaction});

            await queryInterface.createTable(
                SpecimenSpaceReconstructionTableName,
                {
                    id: {
                        primaryKey: true,
                        type: Sequelize.UUID,
                        defaultValue: Sequelize.literal("uuidv7()")
                    },
                    status: {
                        type: Sequelize.INTEGER,
                        allowNull: false,
                        defaultValue: 0
                    },
                    sourceUrl: {
                        type: Sequelize.TEXT,
                        defaultValue: ""
                    },
                    sourceComments: {
                        type: Sequelize.TEXT,
                        defaultValue: ""
                    },
                    lengthMillimeters: {
                        type: Sequelize.DOUBLE,
                        defaultValue: null
                    },
                    nodeCounts: {
                        type: Sequelize.JSONB,
                        defaultValue: null
                    },
                    somaNodeId: {
                        type: Sequelize.UUID,
                        allowNull: true,
                        references: {
                            model: SpecimenNodeTableName,
                            key: "id"
                        }
                    },
                    annotationId: {
                        type: Sequelize.UUID,
                        allowNull: false,
                        references: {
                            model: AnnotationTableName,
                            key: "id"
                        }
                    },
                    createdAt: Sequelize.DATE,
                    updatedAt: Sequelize.DATE,
                    deletedAt: Sequelize.DATE
                },
                {transaction});

            // The id is reused so the SpecimenNode and SpecimenSpacePrecomputed rows, and the parentId of every
            // precomputed event already written, point at the right row without being rewritten.  Raw SQL bypasses
            // the paranoid scope, so soft-deleted rows are copied too.
            await queryInterface.sequelize.query(`
                INSERT INTO "${SpecimenSpaceReconstructionTableName}"
                    ("id", "status", "sourceUrl", "sourceComments", "lengthMillimeters", "nodeCounts", "somaNodeId",
                     "annotationId", "createdAt", "updatedAt", "deletedAt")
                SELECT "id", 0, "sourceUrl", "sourceComments", "specimenLengthMillimeters", "specimenNodeCounts",
                       "specimenSomaNodeId", "id", "createdAt", "updatedAt", "deletedAt"
                FROM "${AnnotationTableName}";
            `, {transaction});

            for (const table of SpecimenDataChildTables) {
                await dropForeignKey(queryInterface, table, AnnotationTableName, transaction);
                await addForeignKey(queryInterface, table, SpecimenSpaceReconstructionTableName, transaction);
            }

            await queryInterface.renameColumn(AtlasReconstructionTableName, "reconstructionId", "annotationId", {transaction});

            for (const column of ["specimenSomaNodeId", "specimenNodeCounts", "specimenLengthMillimeters", "sourceComments", "sourceUrl"]) {
                await queryInterface.removeColumn(AnnotationTableName, column, {transaction});
            }

            await queryInterface.addIndex(SpecimenSpaceReconstructionTableName, ["annotationId"], {unique: true, transaction});
        });
    },

    down: async (queryInterface: QueryInterface, Sequelize: any) => {
        await queryInterface.sequelize.transaction(async (transaction) => {
            await queryInterface.addColumn(AnnotationTableName, "sourceUrl", {type: Sequelize.TEXT, defaultValue: ""}, {transaction});
            await queryInterface.addColumn(AnnotationTableName, "sourceComments", {type: Sequelize.TEXT, defaultValue: ""}, {transaction});
            await queryInterface.addColumn(AnnotationTableName, "specimenLengthMillimeters", {type: Sequelize.DOUBLE, defaultValue: null}, {transaction});
            await queryInterface.addColumn(AnnotationTableName, "specimenNodeCounts", {type: Sequelize.JSONB, defaultValue: null}, {transaction});
            await queryInterface.addColumn(AnnotationTableName, "specimenSomaNodeId", {
                type: Sequelize.UUID,
                references: {
                    model: SpecimenNodeTableName,
                    key: "id"
                }
            }, {transaction});

            await queryInterface.sequelize.query(`
                UPDATE "${AnnotationTableName}" AS annotation
                SET "sourceUrl" = data."sourceUrl", "sourceComments" = data."sourceComments",
                    "specimenLengthMillimeters" = data."lengthMillimeters", "specimenNodeCounts" = data."nodeCounts",
                    "specimenSomaNodeId" = data."somaNodeId"
                FROM "${SpecimenSpaceReconstructionTableName}" AS data
                WHERE data."annotationId" = annotation."id";
            `, {transaction});

            for (const table of SpecimenDataChildTables) {
                await dropForeignKey(queryInterface, table, SpecimenSpaceReconstructionTableName, transaction);

                // Only rows created after the split have a specimen-space id that differs from their annotation id.
                await queryInterface.sequelize.query(`
                    UPDATE "${table}" AS child
                    SET "reconstructionId" = data."annotationId"
                    FROM "${SpecimenSpaceReconstructionTableName}" AS data
                    WHERE child."reconstructionId" = data."id" AND data."id" <> data."annotationId";
                `, {transaction});

                await addForeignKey(queryInterface, table, AnnotationTableName, transaction);
            }

            await queryInterface.renameColumn(AtlasReconstructionTableName, "annotationId", "reconstructionId", {transaction});

            await queryInterface.dropTable(SpecimenSpaceReconstructionTableName, {transaction});

            await queryInterface.renameTable(AnnotationTableName, ReconstructionTableName, {transaction});
        });
    }
};
