import {describe, expect, test} from "vitest";

const {describeReceived, isPlainObject, primitiveText} = require("../src/util/untrustedJson");

// Own toString/valueOf of null make String(), template literals and join throw on this parsed value.
const hostile = () => JSON.parse("{\"toString\": null, \"valueOf\": null}");

describe("primitiveText", () => {
    test.each([
        ["a string", "text", "text"],
        ["a number", 42, "42"],
        ["a boolean", false, "false"]
    ])("keeps %s", (_label: string, value: unknown, expected: string) => {
        expect(primitiveText(value)).toBe(expected);
    });

    test.each([
        ["null", null],
        ["undefined", undefined],
        ["an array", [1]],
        ["an object", {a: 1}],
        ["a hostile object", hostile()]
    ])("gives null for %s", (_label: string, value: unknown) => {
        expect(primitiveText(value)).toBeNull();
    });
});

describe("describeReceived", () => {
    test.each([
        ["a primitive", 7, "7"],
        ["a missing value", undefined, "<missing>"],
        ["null", null, "<null>"],
        ["an array", [], "<array>"],
        ["an object", {}, "<object>"],
        ["a hostile object", hostile(), "<object>"]
    ])("describes %s", (_label: string, value: unknown, expected: string) => {
        expect(describeReceived(value)).toBe(expected);
    });
});

describe("isPlainObject", () => {
    test("accepts objects only", () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject(hostile())).toBe(true);
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject("text")).toBe(false);
    });
});
