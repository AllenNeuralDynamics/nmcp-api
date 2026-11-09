import {expect, test, vi, describe} from "vitest";

const migration = require("../src/migrations/20261109000000-atlas-quality-control");

const transaction = {sentinel: "t"} as any;

function fakeQueryInterface() {
    const calls: string[] = [];

    const queryInterface = {
        renameTable: vi.fn().mockImplementation(async (from: string, to: string, options: any) => {
            expect(options).toEqual({transaction});
            calls.push(`renameTable ${from} -> ${to}`);
        }),
        sequelize: {
            transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction)),
            query: vi.fn().mockImplementation(async (sql: string, options: any) => {
                expect(options).toEqual({transaction});
                calls.push(sql);
            })
        }
    };

    return {queryInterface, calls};
}

describe("the atlas quality control migration", () => {
    test("up renames the table, then its key, foreign key and status index, in one transaction", async () => {
        const {queryInterface, calls} = fakeQueryInterface();

        await migration.up(queryInterface);

        expect(queryInterface.sequelize.transaction).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
            "renameTable QualityControl -> AtlasQualityControl",
            "ALTER TABLE \"AtlasQualityControl\" RENAME CONSTRAINT \"QualityControl_pkey\" TO \"AtlasQualityControl_pkey\";",
            "ALTER TABLE \"AtlasQualityControl\" RENAME CONSTRAINT \"QualityControl_reconstructionId_fkey\" TO \"AtlasQualityControl_reconstructionId_fkey\";",
            "ALTER INDEX \"quality_control_status\" RENAME TO \"atlas_quality_control_status\";"
        ]);
    });

    // The index must come back under the name 20260909000000-phase-failure-columns's down derives to remove it.
    test("down reverses every rename in reverse order and renames the table last", async () => {
        const {queryInterface, calls} = fakeQueryInterface();

        await migration.down(queryInterface);

        expect(queryInterface.sequelize.transaction).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
            "ALTER INDEX \"atlas_quality_control_status\" RENAME TO \"quality_control_status\";",
            "ALTER TABLE \"AtlasQualityControl\" RENAME CONSTRAINT \"AtlasQualityControl_reconstructionId_fkey\" TO \"QualityControl_reconstructionId_fkey\";",
            "ALTER TABLE \"AtlasQualityControl\" RENAME CONSTRAINT \"AtlasQualityControl_pkey\" TO \"QualityControl_pkey\";",
            "renameTable AtlasQualityControl -> QualityControl"
        ]);
    });
});
