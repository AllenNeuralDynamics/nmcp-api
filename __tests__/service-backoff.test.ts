import {expect, test, describe} from "vitest";

import {ServiceBackoff} from "../src/synchronization/serviceBackoff";

describe("ServiceBackoff", () => {
    test("is ready before any failure", () => {
        const backoff = new ServiceBackoff(1000, 8000);

        expect(backoff.ready(0)).toBe(true);
        expect(backoff.currentDelay).toBe(0);
    });

    test("first failure transitions into backoff and sets the base delay", () => {
        const backoff = new ServiceBackoff(1000, 8000);

        expect(backoff.recordFailure(0)).toBe(true);
        expect(backoff.currentDelay).toBe(1000);
        expect(backoff.ready(999)).toBe(false);
        expect(backoff.ready(1000)).toBe(true);
    });

    test("successive failures double the delay and clamp at the cap", () => {
        const backoff = new ServiceBackoff(1000, 8000);

        expect(backoff.recordFailure(0)).toBe(true);
        expect(backoff.currentDelay).toBe(1000);

        expect(backoff.recordFailure(0)).toBe(false);
        expect(backoff.currentDelay).toBe(2000);

        expect(backoff.recordFailure(0)).toBe(false);
        expect(backoff.currentDelay).toBe(4000);

        expect(backoff.recordFailure(0)).toBe(false);
        expect(backoff.currentDelay).toBe(8000);

        expect(backoff.recordFailure(0)).toBe(false);
        expect(backoff.currentDelay).toBe(8000);
    });

    test("ready flips back exactly at nextAttemptTime", () => {
        const backoff = new ServiceBackoff(1000, 8000);

        const start = 5000;
        backoff.recordFailure(start);

        expect(backoff.ready(start + backoff.currentDelay - 1)).toBe(false);
        expect(backoff.ready(start + backoff.currentDelay)).toBe(true);
    });

    test("success transitions out of backoff and resets", () => {
        const backoff = new ServiceBackoff(1000, 8000);

        backoff.recordFailure(0);

        expect(backoff.recordSuccess()).toBe(true);
        expect(backoff.currentDelay).toBe(0);
        expect(backoff.ready(0)).toBe(true);

        expect(backoff.recordSuccess()).toBe(false);
    });
});
