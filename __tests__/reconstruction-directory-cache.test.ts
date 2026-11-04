import {expect, test, describe, vi} from "vitest";

const {ReconstructionDirectoryCache} = require("../src/tools/reconstructionDirectoryCache");

function cacheWith(present: string[]) {
    const lookup = vi.fn().mockImplementation(async (subjectId: string) => present.includes(subjectId));

    return {cache: new ReconstructionDirectoryCache(lookup), lookup: lookup};
}

describe("ReconstructionDirectoryCache", () => {
    test("does not report a speculative miss", async () => {
        const {cache} = cacheWith([]);

        expect(await cache.exists("subject-1", false)).toBe(false);
        expect(cache.missingExpected()).toEqual([]);
    });

    test("reports a speculative miss once a later lookup expected the directory", async () => {
        const {cache, lookup} = cacheWith([]);

        await cache.exists("subject-1", false);
        await cache.exists("subject-1", true);

        expect(cache.missingExpected()).toEqual(["subject-1"]);
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    test("reports the same whichever lookup came first", async () => {
        const {cache, lookup} = cacheWith([]);

        await cache.exists("subject-1", true);
        await cache.exists("subject-1", false);

        expect(cache.missingExpected()).toEqual(["subject-1"]);
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    test("reports an expected miss looked up twice once", async () => {
        const {cache} = cacheWith([]);

        await cache.exists("subject-1", true);
        await cache.exists("subject-1", true);

        expect(cache.missingExpected()).toEqual(["subject-1"]);
    });

    test("never reports a directory that exists", async () => {
        const {cache} = cacheWith(["subject-1"]);

        expect(await cache.exists("subject-1", true)).toBe(true);
        expect(cache.missingExpected()).toEqual([]);
    });

    test("looks each subject up once", async () => {
        const {cache, lookup} = cacheWith(["subject-1"]);

        for (let index = 0; index < 3; index++) {
            await cache.exists("subject-1", index % 2 == 0);
            await cache.exists("subject-2", index % 2 == 0);
        }

        expect(lookup).toHaveBeenCalledTimes(2);
    });
});
