import {describe, expect, test, vi} from "vitest";

const migration = require("../src/migrations/20261110000000-raw-upload-quality-control");

const transaction = {sentinel: "t"} as any;

const Sequelize = {UUID: "UUID", INTEGER: "INTEGER"};

function fakeQueryInterface() {
    const calls: string[] = [];

    const queryInterface = {
        addColumn: vi.fn().mockImplementation(async (table: string, column: string, attributes: any, options: any) => {
            expect(options).toEqual({transaction});
            calls.push(`add ${table}.${column} ${attributes.type} null=${attributes.allowNull} default=${attributes.defaultValue}`);
        }),
        removeColumn: vi.fn().mockImplementation(async (table: string, column: string, options: any) => {
            expect(options).toEqual({transaction});
            calls.push(`remove ${table}.${column}`);
        }),
        sequelize: {
            transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction))
        }
    };

    return {queryInterface, calls};
}

describe("the raw upload quality control migration", () => {
    test("up adds the nullable qcTag and skeletonId columns in one transaction", async () => {
        const {queryInterface, calls} = fakeQueryInterface();

        await migration.up(queryInterface, Sequelize);

        expect(queryInterface.sequelize.transaction).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
            "add RawReconstructionUpload.qcTag UUID null=true default=null",
            "add RawReconstructionUpload.skeletonId INTEGER null=true default=null"
        ]);
    });

    test("down removes both columns in one transaction", async () => {
        const {queryInterface, calls} = fakeQueryInterface();

        await migration.down(queryInterface, Sequelize);

        expect(queryInterface.sequelize.transaction).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
            "remove RawReconstructionUpload.skeletonId",
            "remove RawReconstructionUpload.qcTag"
        ]);
    });
});
