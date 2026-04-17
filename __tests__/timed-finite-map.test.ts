import {expect, test, vi, afterEach} from "vitest";

import {TimedFiniteMap} from "../src/util/timedFiniteMap";

afterEach(() => {
    vi.restoreAllMocks();
});

test("stores and retrieves values", () => {
    const cache = new TimedFiniteMap<string, number>(10, 60_000);

    cache.setTimed("a", 1);
    cache.setTimed("b", 2);

    expect(cache.getTimed("a")).toBe(1);
    expect(cache.getTimed("b")).toBe(2);
    expect(cache.size).toBe(2);
});

test("returns undefined for missing keys", () => {
    const cache = new TimedFiniteMap<string, number>(10, 60_000);

    expect(cache.getTimed("missing")).toBeUndefined();
});

test("expires entries after TTL", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cache = new TimedFiniteMap<string, number>(10, 1000);

    cache.setTimed("key", 42);
    expect(cache.getTimed("key")).toBe(42);

    vi.spyOn(Date, "now").mockReturnValue(now + 999);
    expect(cache.getTimed("key")).toBe(42);

    vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    expect(cache.getTimed("key")).toBeUndefined();
    expect(cache.size).toBe(0);
});

test("has returns false for expired entries", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const cache = new TimedFiniteMap<string, string>(10, 500);

    cache.setTimed("key", "value");
    expect(cache.has("key")).toBe(true);

    vi.spyOn(Date, "now").mockReturnValue(now + 500);
    expect(cache.has("key")).toBe(false);
});

test("evicts oldest entries when aging limit is exceeded", () => {
    const cache = new TimedFiniteMap<string, number>(3, 60_000);

    cache.setTimed("a", 1);
    cache.setTimed("b", 2);
    cache.setTimed("c", 3);

    expect(cache.size).toBe(3);

    cache.setTimed("d", 4);

    expect(cache.size).toBe(3);
    expect(cache.getTimed("a")).toBeUndefined();
    expect(cache.getTimed("b")).toBe(2);
    expect(cache.getTimed("c")).toBe(3);
    expect(cache.getTimed("d")).toBe(4);
});

test("overwriting a key does not cause premature eviction", () => {
    const cache = new TimedFiniteMap<string, number>(3, 60_000);

    cache.setTimed("a", 1);
    cache.setTimed("b", 2);
    cache.setTimed("a", 10);
    cache.setTimed("c", 3);

    expect(cache.size).toBe(3);
    expect(cache.getTimed("a")).toBe(10);
    expect(cache.getTimed("b")).toBe(2);
    expect(cache.getTimed("c")).toBe(3);
});
