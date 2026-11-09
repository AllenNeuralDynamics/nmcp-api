import {afterEach, describe, expect, test, vi} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {
    PrecomputedService,
    PrecomputedServiceStatus,
    failureMessage,
    toPrecomputedResult
} = require("../src/data-access/precomputedService");
const {CoreServiceOptions} = require("../src/options/coreServicesOptions");

const tag = "0196a2c4-0000-7000-8000-000000000001";

const location = "s3://bucket/precomputed/nmcp-qc-" + tag;

const reconstruction = {
    id: tag,
    neuron: {label: "N1", specimen: {label: "S1", genotype: "G1"}},
    nodes: [{index: 1, structure: 1, x: 0, y: 0, z: 0, radius: 1, parentIndex: -1}]
};

// Own toString/valueOf of null make String(), template literals and join throw on this parsed value.
const hostile = () => JSON.parse("{\"toString\": null, \"valueOf\": null}");

function successBody(result: object = {}, overrides: object = {}) {
    return {
        serviceVersion: "1.2.0",
        reconstructionId: tag,
        result: {location: "s3://bucket/precomputed/nmcp-qc-" + tag + "/", segmentId: 1, nodeCount: 1, edgeCount: 0, ...result},
        errorKind: null,
        errorDescription: null,
        errorInfo: null,
        ...overrides
    };
}

function respondWith(status: number, body: any) {
    return vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status: status,
        json: async () => body
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("PrecomputedService.generateSkeleton", () => {
    test("posts the location, segment and reconstruction as camelCase JSON to the configured endpoint, with a deadline", async () => {
        const fetchMock = respondWith(200, successBody());
        vi.stubGlobal("fetch", fetchMock);

        await PrecomputedService.generateSkeleton(location, 1, reconstruction);

        const options = CoreServiceOptions.rest.precomputed;
        const [url, init] = fetchMock.mock.calls[0];

        expect(url).toBe(`http://${options.host}:${options.port}${options.endpoint}`);
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toEqual({location, segmentId: 1, reconstruction});
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    test("a result that describes the requested skeleton is a success, whatever the normalized location's text", async () => {
        vi.stubGlobal("fetch", respondWith(200, successBody()));

        const result = await PrecomputedService.generateSkeleton(location, 1, reconstruction);

        expect(result).toEqual({serviceStatus: PrecomputedServiceStatus.Success, errorKind: null, errorDescription: null, httpStatus: null});
    });

    test("a reported error carries its kind and description", async () => {
        vi.stubGlobal("fetch", respondWith(200, {
            serviceVersion: "1.2.0", reconstructionId: tag, result: null,
            errorKind: "GenerationError", errorDescription: "no nodes", errorInfo: "Traceback"
        }));

        const result = await PrecomputedService.generateSkeleton(location, 1, reconstruction);

        expect(result).toEqual({serviceStatus: PrecomputedServiceStatus.Error, errorKind: "GenerationError", errorDescription: "no nodes", httpStatus: null});
    });

    test.each([422, 500])("HTTP %s is an error", async (status: number) => {
        vi.stubGlobal("fetch", respondWith(status, {}));

        const result = await PrecomputedService.generateSkeleton(location, 1, reconstruction);

        expect(result.serviceStatus).toBe(PrecomputedServiceStatus.Error);
        expect(result.httpStatus).toBe(status);
    });

    test("a rejected fetch is unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

        const result = await PrecomputedService.generateSkeleton(location, 1, reconstruction);

        expect(result.serviceStatus).toBe(PrecomputedServiceStatus.Unavailable);
    });

    test("a timeout is unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")));

        const result = await PrecomputedService.generateSkeleton(location, 1, reconstruction);

        expect(result.serviceStatus).toBe(PrecomputedServiceStatus.Unavailable);
    });
});

describe("toPrecomputedResult with responses that look successful but are not", () => {
    test("a mismatched reconstruction id names both ids", () => {
        const result = toPrecomputedResult(tag, 1, successBody({}, {reconstructionId: "other-tag"}));

        expect(result.serviceStatus).toBe(PrecomputedServiceStatus.Error);
        expect(result.errorKind).toBe("ReconstructionIdMismatch");
        expect(result.errorDescription).toContain("other-tag");
        expect(result.errorDescription).toContain(tag);
    });

    test.each([
        ["an empty result", {result: {}}],
        ["another segment", {result: successBody({segmentId: 2}).result}],
        ["a missing node count", {result: successBody({nodeCount: undefined}).result}],
        ["a non-numeric edge count", {result: successBody({edgeCount: "3"}).result}],
        ["an empty location", {result: successBody({location: ""}).result}],
        ["a non-object result", {result: "done"}]
    ])("%s is malformed", (_label: string, overrides: object) => {
        const result = toPrecomputedResult(tag, 1, successBody({}, overrides));

        expect(result.serviceStatus).toBe(PrecomputedServiceStatus.Error);
        expect(result.errorKind).toBe("MalformedResponse");
    });

    test.each([
        ["a null body", null],
        ["an array body", []],
        ["a hostile error kind", {...successBody(), errorKind: hostile(), errorDescription: hostile()}],
        ["a hostile reconstruction id", {...successBody(), reconstructionId: hostile()}],
        ["a hostile segment id", successBody({segmentId: hostile()})]
    ])("%s is an error without throwing", (_label: string, body: unknown) => {
        const result = toPrecomputedResult(tag, 1, body);

        expect(result.serviceStatus).toBe(PrecomputedServiceStatus.Error);
        expect(() => failureMessage(result)).not.toThrow();
    });
});

describe("failureMessage", () => {
    test("reports an unreachable service", () => {
        expect(failureMessage({serviceStatus: PrecomputedServiceStatus.Unavailable, errorKind: null, errorDescription: null, httpStatus: null}))
            .toBe("The precomputed service could not be reached.");
    });

    test("reports an HTTP status", () => {
        expect(failureMessage({serviceStatus: PrecomputedServiceStatus.Error, errorKind: null, errorDescription: null, httpStatus: 500}))
            .toBe("The precomputed service returned HTTP 500.");
    });

    test("reports a generation failure without the error info", async () => {
        vi.stubGlobal("fetch", respondWith(200, {
            serviceVersion: "1.2.0", reconstructionId: tag, result: null,
            errorKind: "GenerationError", errorDescription: "no nodes", errorInfo: "secret traceback"
        }));

        const message = failureMessage(await PrecomputedService.generateSkeleton(location, 1, reconstruction));

        expect(message).toBe("Skeleton generation failed (GenerationError): no nodes.");
        expect(message).not.toContain("secret traceback");
    });
});
