import {expect, test} from "vitest";

import {mergeJsonProperties} from "../src/util/objectUtil";

//
// mergeJsonProperties
//

test("an empty column takes the update as given", () => {
    expect(mergeJsonProperties(null, {priority: 1})).toStrictEqual({priority: 1});
    expect(mergeJsonProperties(undefined, {priority: 1})).toStrictEqual({priority: 1});
});

test("an empty update on an empty column produces an empty object", () => {
    expect(mergeJsonProperties(null, {})).toStrictEqual({});
});

test("a supplied key overwrites the stored value", () => {
    expect(mergeJsonProperties({priority: 1}, {priority: 2})).toStrictEqual({priority: 2});
});

test("keys the update leaves out keep their stored values", () => {
    expect(mergeJsonProperties({instance: 1, priority: 2, somaGroup: "a"}, {priority: 5}))
        .toStrictEqual({instance: 1, priority: 5, somaGroup: "a"});
});

test("a new key is added", () => {
    expect(mergeJsonProperties<object>({priority: 2}, {somaGroup: "g"})).toStrictEqual({priority: 2, somaGroup: "g"});
});

test("a null is stored as a value rather than removing the key", () => {
    expect(mergeJsonProperties({somaGroup: "a"}, {somaGroup: null})).toStrictEqual({somaGroup: null});
});

test("an undefined value neither overwrites nor removes the stored key", () => {
    expect(mergeJsonProperties({priority: 1}, {priority: undefined})).toStrictEqual({priority: 1});
});

test("returns a new object and leaves both arguments untouched", () => {
    const stored = {instance: 1, priority: 2};
    const update = {priority: 5};

    const merged = mergeJsonProperties(stored, update);

    expect(merged).not.toBe(stored);
    expect(merged).not.toBe(update);
    expect(stored).toStrictEqual({instance: 1, priority: 2});
    expect(update).toStrictEqual({priority: 5});
});

test("accepts an update with no prototype, as GraphQL builds for inline arguments", () => {
    const update = Object.create(null);
    update.somaGroup = "g";

    const merged = mergeJsonProperties<object>({priority: 2}, update);

    expect(merged).toEqual({priority: 2, somaGroup: "g"});
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
});
