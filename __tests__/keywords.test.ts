import {expect, test} from "vitest";

import {normalizeKeywords, substringMatchPatterns} from "../src/util/keywords";

//
// normalizeKeywords
//

test("treats absent, null and empty input as no keywords", () => {
    expect(normalizeKeywords(undefined)).toEqual([]);
    expect(normalizeKeywords(null)).toEqual([]);
    expect(normalizeKeywords([])).toEqual([]);
    expect(normalizeKeywords("")).toEqual([]);
});

test("passes through a list that is already normalized", () => {
    expect(normalizeKeywords(["one", "two", "three"])).toEqual(["one", "two", "three"]);
});

test("treats a bare string as a single keyword", () => {
    expect(normalizeKeywords("one")).toEqual(["one"]);
});

test("does not split on a comma - the client decides what one keyword is", () => {
    expect(normalizeKeywords("one, two, three")).toEqual(["one, two, three"]);
    expect(normalizeKeywords(["one, two, three"])).toEqual(["one, two, three"]);
    expect(normalizeKeywords(["alpha", "beta, gamma"])).toEqual(["alpha", "beta, gamma"]);
});

test("does not split on any other separator either", () => {
    expect(normalizeKeywords(["one;two"])).toEqual(["one;two"]);
    expect(normalizeKeywords(["one|two"])).toEqual(["one|two"]);
});

test("trims surrounding whitespace", () => {
    expect(normalizeKeywords(["  cortex  ", " striatum"])).toEqual(["cortex", "striatum"]);
});

test("drops empty and whitespace-only entries", () => {
    expect(normalizeKeywords([" a ", "", "   ", "b"])).toEqual(["a", "b"]);
});

test("drops null and undefined elements", () => {
    expect(normalizeKeywords([null, "a", undefined])).toEqual(["a"]);
});

test("removes duplicates without regard to case, keeping the first occurrence", () => {
    expect(normalizeKeywords(["Two", "two", "  TWO  "])).toEqual(["Two"]);
    expect(normalizeKeywords(["one", "one"])).toEqual(["one"]);
});

test("preserves the given order rather than sorting", () => {
    expect(normalizeKeywords(["b", "a", "c"])).toEqual(["b", "a", "c"]);
});

test("keeps multi-word phrases intact", () => {
    expect(normalizeKeywords(["multi word phrase", "other"])).toEqual(["multi word phrase", "other"]);
});

test("is idempotent", () => {
    const once = normalizeKeywords(["  One ", "one", "TWO", "two", ""]);

    expect(normalizeKeywords(once)).toEqual(once);
});

//
// substringMatchPatterns
//

test("returns no patterns when there is nothing to filter on", () => {
    // The filter call sites treat an empty result as "no filter at all".
    expect(substringMatchPatterns(undefined)).toEqual([]);
    expect(substringMatchPatterns(null)).toEqual([]);
    expect(substringMatchPatterns([])).toEqual([]);
    expect(substringMatchPatterns([""])).toEqual([]);
    expect(substringMatchPatterns([" "])).toEqual([]);
});

test("wraps each value as a substring pattern", () => {
    expect(substringMatchPatterns(["two"])).toEqual(["%two%"]);
    expect(substringMatchPatterns(["one", "two"])).toEqual(["%one%", "%two%"]);
});

test("applies the same normalization as normalizeKeywords", () => {
    expect(substringMatchPatterns(" one ")).toEqual(["%one%"]);
    expect(substringMatchPatterns(["Two", "two"])).toEqual(["%Two%"]);
});

test("keeps a comma inside a value rather than splitting on it", () => {
    expect(substringMatchPatterns(["Slc17a7-IRES2-Cre,Ai93"])).toEqual(["%Slc17a7-IRES2-Cre,Ai93%"]);
});

test("escapes LIKE wildcards so they match literally", () => {
    expect(substringMatchPatterns(["50%"])).toEqual(["%50\\%%"]);
    expect(substringMatchPatterns(["a_b"])).toEqual(["%a\\_b%"]);
    expect(substringMatchPatterns(["a\\b"])).toEqual(["%a\\\\b%"]);
});

test("leaves quotes and SQL-looking text as ordinary characters", () => {
    // These reach the query as bound replacements, so nothing here needs escaping - but the pattern must not
    // mangle them either.
    expect(substringMatchPatterns(["bad' OR true --"])).toEqual(["%bad' OR true --%"]);
});
