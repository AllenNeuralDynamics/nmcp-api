import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {DataCiteService, DataCiteServiceStatus} = require("../src/data-access/doi/dataCiteService");
const {CoreServiceOptions} = require("../src/options/coreServicesOptions");

// The only tests that exercise the Error/Unavailable boundary itself - everything else in the suite stubs the client
// with already-classified results and so cannot see it.

const options = CoreServiceOptions.rest.doiGeneration;

const configured = {prefix: options.prefix, user: options.user, password: options.password};

// A minimal well-formed success body: request() reads data.attributes.doi off it.
const successBody = {data: {attributes: {doi: "10.x/created", relatedIdentifiers: []}}};

function respondWith(status: number, body: any, contentType: string = "application/json") {
    return vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status: status,
        json: async () => {
            if (contentType !== "application/json") {
                throw new SyntaxError("Unexpected token < in JSON");
            }
            return body;
        },
        text: async () => (contentType === "application/json" ? JSON.stringify(body) : body)
    });
}

function createRequest(attributes: object = {}) {
    return {
        data: {
            type: "dois",
            attributes: {
                prefix: options.prefix,
                creators: [{name: "Test"}],
                titles: [{title: "Test"}],
                publisher: "Test",
                publicationYear: 2026,
                types: {resourceTypeGeneral: "Dataset"},
                url: "https://example.org/neuron/1",
                ...attributes
            }
        }
    };
}

// The whole request body of the single fetch call, parsed.
function sentAttributes(fetchMock: any) {
    return JSON.parse(fetchMock.mock.calls[0][1].body).data.attributes;
}

beforeEach(() => {
    options.prefix = "10.83594";
    options.user = "test-user";
    options.password = "test-password";
});

afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(options, configured);
});

describe("request classification", () => {
    test("a rejection carrying a JSON error body is an Error", async () => {
        vi.stubGlobal("fetch", respondWith(422, {errors: [{title: "already exists"}]}));

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Error);
        expect(result.serviceError).toBe("422");
    });

    test("a rejection carrying an empty body is an Error, not Unavailable", async () => {
        vi.stubGlobal("fetch", respondWith(500, "", "text/plain"));

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Error);
    });

    test("a rejection carrying an HTML body is an Error, not Unavailable", async () => {
        vi.stubGlobal("fetch", respondWith(503, "<html><body>Service Unavailable</body></html>", "text/html"));

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Error);
        expect(result.serviceError).toBe("503");
    });

    test("a rejection whose body cannot even be read is still an Error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 502,
            text: async () => {
                throw new Error("stream closed");
            }
        }));

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Error);
    });

    test("a fetch that rejects is Unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Unavailable);
    });

    test("an aborted request is Unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted."), {name: "TimeoutError"})));

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Unavailable);
    });

    test("the request carries an abort signal so a hung service cannot pin a connection", async () => {
        const fetchMock = respondWith(201, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.createDoi(createRequest());

        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    test("missing configuration is Unavailable without calling fetch", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        options.password = "";

        const result = await DataCiteService.createDoi(createRequest());

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Unavailable);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("getRelatedIdentifiers", () => {
    test("a failed read reports the failing status with an empty list", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

        const result = await DataCiteService.getRelatedIdentifiers("10.x/canonical");

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Unavailable);
        expect(result.relatedIdentifiers).toEqual([]);
    });

    test("a successful read returns the response's identifiers", async () => {
        const entry = {relatedIdentifierType: "DOI", relationType: "HasVersion", relatedIdentifier: "10.x/abc", resourceTypeGeneral: "Dataset"};

        vi.stubGlobal("fetch", respondWith(200, {data: {attributes: {doi: "10.x/canonical", relatedIdentifiers: [entry]}}}));

        const result = await DataCiteService.getRelatedIdentifiers("10.x/canonical");

        expect(result.serviceStatus).toBe(DataCiteServiceStatus.Success);
        expect(result.relatedIdentifiers).toEqual([entry]);
    });
});

describe("payloads", () => {
    test("createDoi sends no event when the payload omits it - the draft reserve", async () => {
        const fetchMock = respondWith(201, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.createDoi(createRequest());

        expect(sentAttributes(fetchMock)).not.toHaveProperty("event");
    });

    test("createDoi still sends an event when the payload carries one", async () => {
        const fetchMock = respondWith(201, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.createDoi(createRequest({event: "publish"}));

        expect(sentAttributes(fetchMock).event).toBe("publish");
    });

    test("updateDoi without an event PUTs only the related identifiers", async () => {
        const fetchMock = respondWith(200, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.updateDoi("10.x/canonical", []);

        expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
        expect(sentAttributes(fetchMock)).toEqual({relatedIdentifiers: []});
    });

    test("updateDoi with an event PUTs both", async () => {
        const fetchMock = respondWith(200, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.updateDoi("10.x/canonical", [], "publish");

        expect(sentAttributes(fetchMock)).toEqual({relatedIdentifiers: [], event: "publish"});
    });

    test("promoteDoi PUTs the event and nothing else", async () => {
        const fetchMock = respondWith(200, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.promoteDoi("10.x/abc");

        expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
        expect(sentAttributes(fetchMock)).toEqual({event: "publish"});
    });

    // The phase never removes a DOI: an unrecorded reserve is left where it is, because a client that has just failed
    // to write cannot establish whether the reserve was recorded, and deleting one that was is far worse.
    test("no client method issues a DELETE", async () => {
        const fetchMock = respondWith(200, successBody);
        vi.stubGlobal("fetch", fetchMock);

        await DataCiteService.createDoi(createRequest());
        await DataCiteService.updateDoi("10.x/canonical", [], "publish");
        await DataCiteService.promoteDoi("10.x/abc");
        await DataCiteService.getDoi("10.x/abc");

        expect(fetchMock.mock.calls.every((call: any[]) => call[1].method !== "DELETE")).toBe(true);
    });
});
