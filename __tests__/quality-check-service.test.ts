import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {
    QualityCheckService,
    QualityCheckServiceStatus,
    QualityControlScore,
    QualityControlServiceVersion,
    failedMetricNames,
    qualityControlFailureReason,
    toQualityControlOutput
} = require("../src/data-access/qualityCheckService");
const {CoreServiceOptions} = require("../src/options/coreServicesOptions");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const nmcpQcDocument = require("./fixtures/nmcp-qc-document.json");

const nodes = [{index: 1, structure: 1, x: 0, y: 0, z: 0, radius: 1, parentIndex: -1}];

// Own toString/valueOf of null make String(), template literals and join throw on this parsed value.
const hostile = () => JSON.parse("{\"toString\": null, \"valueOf\": null}");

function metric(name: string, ...statuses: string[]) {
    return {name, status_history: statuses.map(status => ({status}))};
}

function envelope(overrides: object = {}) {
    return {
        serviceVersion: "3.0.3",
        standardMorphVersion: "1.0.3",
        reconstructionId: "atlas-1",
        qualityControl: {metrics: [metric("non_empty", "Pass"), metric("unique_node_ids", "Pass")]},
        error: null,
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

function sentBody(fetchMock: any) {
    return JSON.parse(fetchMock.mock.calls[0][1].body);
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("toQualityControlOutput scoring", () => {
    test("an all-Pass document passes and keeps what it received", () => {
        const body = envelope();

        const output = toQualityControlOutput("atlas-1", body);

        expect(output.score).toBe(QualityControlScore.Passed);
        expect(output.error).toBeNull();
        expect(output.serviceVersion).toBe(QualityControlServiceVersion.v03);
        expect(output.serviceVersion).toBe(3);
        expect(output.toolVersion).toBe("1.0.3");
        expect(output.when).toBeInstanceOf(Date);
        expect(output.qcServiceVersion).toBe("3.0.3");
        expect(output.qualityControl).toBe(body.qualityControl);
    });

    test("a pending metric without a failure passes with warnings", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics: [metric("a", "Pass"), metric("b", "Pending")]}}));

        expect(output.score).toBe(QualityControlScore.PassedWithWarnings);
    });

    test("a failing metric among pending ones fails", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics: [metric("a", "Pending"), metric("b", "Fail")]}}));

        expect(output.score).toBe(QualityControlScore.Failed);
    });

    test.each([
        [["Fail", "Pass"], QualityControlScore.Passed],
        [["Pass", "Fail"], QualityControlScore.Failed]
    ])("the latest status of %j decides", (statuses: string[], score: number) => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics: [metric("x", ...statuses)]}}));

        expect(output.score).toBe(score);
    });

    test("the nmcp-qc sample document fails on its two failing metrics", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: nmcpQcDocument}));

        expect(output.score).toBe(QualityControlScore.Failed);
        expect(failedMetricNames(output)).toEqual(["duplicate_node_coordinates", "edge_length"]);
    });

    test("a missing standard-morph version leaves the tool version empty", () => {
        const body: any = envelope();
        delete body.standardMorphVersion;

        expect(toQualityControlOutput("atlas-1", body).toolVersion).toBe("");
    });
});

describe("toQualityControlOutput errors", () => {
    test("a service error is copied field for field", () => {
        const error = {stage: "standard_morph", kind: "ValueError", description: "d", info: "i"};

        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: null, error}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error).toEqual(error);
    });

    test("no document and no error is a missing document", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: null}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error).toMatchObject({stage: "response", kind: "MissingDocument"});
    });

    test("an empty metric list fails closed", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics: []}}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error).toMatchObject({stage: "response", kind: "MalformedDocument"});
    });

    test.each([
        ["an empty history", {name: "x", status_history: []}],
        ["an unknown status", metric("x", "Unknown")]
    ])("a metric with %s is malformed", (_label: string, entry: object) => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics: [metric("a", "Pass"), entry]}}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error.kind).toBe("MalformedDocument");
    });

    test.each([
        ["null", null],
        ["an array", []],
        ["a string", "text"],
        ["a number", 42]
    ])("a body that is %s is a malformed response", (_label: string, body: any) => {
        const output = toQualityControlOutput("atlas-1", body);

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error).toMatchObject({stage: "response", kind: "MalformedResponse"});
        expect(output.toolVersion).toBe("");
        expect(output.qcServiceVersion).toBe("");
        expect(output.qualityControl).toBeNull();
    });

    test.each([
        ["a null metric", [null]],
        ["a numeric metric", [42]],
        ["a history that is a string", [{name: "x", status_history: "Pass"}]],
        ["a null history entry", [{name: "x", status_history: [null]}]]
    ])("%s is a malformed document", (_label: string, metrics: any[]) => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics}}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error.kind).toBe("MalformedDocument");
    });

    test("an error that is not an object falls back to placeholders", () => {
        const output = toQualityControlOutput("atlas-1", envelope({error: "boom"}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error).toEqual({stage: "unknown", kind: "unknown", description: "no description", info: null});
    });

    test("a mismatched id is an error even with an all-Pass document, and the document is kept", () => {
        const body = envelope({reconstructionId: "atlas-2"});

        const output = toQualityControlOutput("atlas-1", body);

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error.kind).toBe("ReconstructionIdMismatch");
        expect(output.error.description).toContain("atlas-1");
        expect(output.error.description).toContain("atlas-2");
        expect(output.qualityControl).toBe(body.qualityControl);
    });

    test("a mismatch is reported ahead of a service error", () => {
        const output = toQualityControlOutput("atlas-1", envelope({reconstructionId: "atlas-2", error: {stage: "input", kind: "KeyError", description: "d"}}));

        expect(output.error.kind).toBe("ReconstructionIdMismatch");
    });

    test("a numeric mismatched id is rendered as itself", () => {
        expect(toQualityControlOutput("atlas-1", envelope({reconstructionId: 7})).error.description).toContain("7");
    });
});

describe("toQualityControlOutput with values that cannot become text", () => {
    test("an object-valued mismatched id does not throw", () => {
        const output = toQualityControlOutput("atlas-1", envelope({reconstructionId: hostile()}));

        expect(output.score).toBe(QualityControlScore.Error);
        expect(output.error.kind).toBe("ReconstructionIdMismatch");
        expect(output.error.description).toContain("<object>");
        expect(output.error.description).toContain("atlas-1");
    });

    test("object-valued error fields fall back to placeholders", () => {
        const error = {stage: hostile(), kind: hostile(), description: hostile(), info: hostile()};

        const output = toQualityControlOutput("atlas-1", envelope({error}));

        expect(output.error).toEqual({stage: "unknown", kind: "unknown", description: "no description", info: null});
    });

    test("a failing metric without a string name is reported by index", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: {metrics: [metric("a", "Pass"), {name: hostile(), status_history: [{status: "Fail"}]}]}}));

        expect(output.score).toBe(QualityControlScore.Failed);
        expect(failedMetricNames(output)).toEqual(["metric 1"]);
    });
});

describe("performQualityCheck", () => {
    const qualityCheck = CoreServiceOptions.rest.qualityCheck;

    test("posts the caller's nodes and registration, without the absent options", async () => {
        const fetchMock = respondWith(200, envelope());
        vi.stubGlobal("fetch", fetchMock);

        await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(`http://${qualityCheck.host}:${qualityCheck.port}${qualityCheck.endpoint}`);

        const body = sentBody(fetchMock);

        expect(body.id).toBe("atlas-1");
        expect(body.data).toEqual(nodes);
        expect(body.isRegistered).toBe(true);
        expect(Object.keys(body).sort()).toEqual(["data", "id", "isRegistered"]);
    });

    test("passes the options through as given", async () => {
        const fetchMock = respondWith(200, envelope());
        vi.stubGlobal("fetch", fetchMock);

        const options = {isRegistered: false, skeletonSource: "s3://s", segmentIds: [7], imageSource: "s3://i"};

        await QualityCheckService.performQualityCheck("atlas-1", nodes, options);

        expect(sentBody(fetchMock)).toMatchObject(options);
    });

    test("a successful call returns the converted output", async () => {
        vi.stubGlobal("fetch", respondWith(200, envelope()));

        const result = await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(result.reconstructionId).toBe("atlas-1");
        expect(result.serviceStatus).toBe(QualityCheckServiceStatus.Success);
        expect(result.serviceError).toBeNull();
        expect(result.output).toEqual({...toQualityControlOutput("atlas-1", envelope()), when: expect.any(Date)});
    });

    test("a mismatched response still reports the caller's id", async () => {
        vi.stubGlobal("fetch", respondWith(200, envelope({reconstructionId: "atlas-2"})));

        const result = await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(result.reconstructionId).toBe("atlas-1");
        expect(result.serviceStatus).toBe(QualityCheckServiceStatus.Success);
        expect(result.output.score).toBe(QualityControlScore.Error);
    });

    test.each([
        ["a null body", () => null, "MalformedResponse"],
        ["a null metric", () => envelope({qualityControl: {metrics: [null]}}), "MalformedDocument"],
        ["an object-valued id", () => envelope({reconstructionId: hostile()}), "ReconstructionIdMismatch"],
        ["an object-valued error kind", () => envelope({error: {stage: "input", kind: hostile(), description: "d"}}), "unknown"]
    ])("a 200 with %s is recorded, not retried", async (_label: string, body: () => any, kind: string) => {
        vi.stubGlobal("fetch", respondWith(200, body()));

        const result = await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(result.serviceStatus).toBe(QualityCheckServiceStatus.Success);
        expect(result.output.score).toBe(QualityControlScore.Error);
        expect(result.output.error.kind).toBe(kind);
    });

    test("a non-OK response is a service error with no output", async () => {
        vi.stubGlobal("fetch", respondWith(500, ""));

        const result = await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(result.serviceStatus).toBe(QualityCheckServiceStatus.Error);
        expect(result.output).toBeNull();
        expect(result.serviceError).toBe("500");
    });

    test("a rejected fetch is unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

        const result = await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(result.serviceStatus).toBe(QualityCheckServiceStatus.Unavailable);
    });

    test("a body that is not JSON is unavailable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError("Unexpected token < in JSON");
            }
        }));

        const result = await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(result.serviceStatus).toBe(QualityCheckServiceStatus.Unavailable);
    });

    test("never touches the atlas reconstruction", async () => {
        vi.stubGlobal("fetch", respondWith(200, envelope()));

        const serializeNodes = vi.spyOn(AtlasReconstruction, "serializeNodes");

        await QualityCheckService.performQualityCheck("atlas-1", nodes, {isRegistered: true});

        expect(serializeNodes).not.toHaveBeenCalled();
    });
});

describe("qualityControlFailureReason", () => {
    test("names the failing metrics of a Failed score", () => {
        const output = toQualityControlOutput("atlas-1", envelope({qualityControl: nmcpQcDocument}));

        expect(qualityControlFailureReason(output)).toBe("quality control failed 2 metric(s): duplicate_node_coordinates, edge_length");
    });

    test("describes an Error score's service error without its info", () => {
        const output = toQualityControlOutput("atlas-1", envelope({
            qualityControl: null,
            error: {stage: "standard_morph", kind: "ValueError", description: "bad input", info: "Traceback (most recent call last)"}
        }));

        expect(qualityControlFailureReason(output)).toBe("quality control service error (standard_morph, ValueError): bad input");
    });

    test.each([
        ["Passed", envelope()],
        ["PassedWithWarnings", envelope({qualityControl: {metrics: [metric("non_empty", "Pending")]}})]
    ])("is null for %s", (_label: string, body: any) => {
        expect(qualityControlFailureReason(toQualityControlOutput("atlas-1", body))).toBeNull();
    });
});
