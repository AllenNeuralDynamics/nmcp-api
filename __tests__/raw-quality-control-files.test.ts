import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";

const fs = require("fs");
const os = require("os");
const path = require("path");

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const files = require("../src/io/rawQualityControlFiles");
const {CoreServiceOptions} = require("../src/options/coreServicesOptions");

const tag = "0196a2c4-0000-7000-8000-000000000001";

let directory: string;
let saved: any;

function uploadFile(overrides: object = {}) {
    return {
        version: 1,
        qcTag: tag,
        annotationId: "annotation-1",
        notes: "the notes",
        skeletonSource: "s3://bucket/precomputed/nmcp-qc-" + tag,
        segmentId: 1,
        source: "neuron.swc",
        comments: "# a comment\n",
        rows: [{index: 1, parentIndex: -1, structure: 1, x: 1, y: 2, z: 3, radius: 1, atlasStructure: null}],
        ...overrides
    };
}

beforeEach(async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "raw-qc-"));
    saved = {...CoreServiceOptions.qualityControl};
    CoreServiceOptions.qualityControl.blobOutput = directory;
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.assign(CoreServiceOptions.qualityControl, saved);
    await fs.promises.rm(directory, {recursive: true, force: true});
});

describe("raw quality control files", () => {
    test("live under <blob output>/raw, named by the QC tag", () => {
        expect(files.rawQualityControlDirectory()).toBe(path.join(directory, "raw"));
        expect(files.uploadFilePath(tag)).toBe(path.join(directory, "raw", `nmcp-upload-${tag}.json`));
        expect(files.qualityControlDocumentPath(tag)).toBe(path.join(directory, "raw", `nmcp-qc-${tag}.json`));
    });

    test("the hand-off file round-trips and creates raw/", async () => {
        const file = uploadFile();

        expect(await files.uploadFileExists(tag)).toBe(false);

        await files.writeUploadFile(file);

        expect(fs.statSync(path.join(directory, "raw")).isDirectory()).toBe(true);
        expect(await files.uploadFileExists(tag)).toBe(true);
        expect(await files.readUploadFile(tag)).toEqual(file);
    });

    test("reading rejects a missing file, bad JSON, or another version", async () => {
        await expect(files.readUploadFile(tag)).rejects.toThrow();

        await fs.promises.mkdir(path.join(directory, "raw"), {recursive: true});
        await fs.promises.writeFile(files.uploadFilePath(tag), "{not json");

        await expect(files.readUploadFile(tag)).rejects.toThrow();

        await files.writeUploadFile(uploadFile({version: 2}));

        await expect(files.readUploadFile(tag)).rejects.toThrow("Unsupported raw upload file version 2");
    });

    test("the QC document is written through a temporary file renamed over the final name", async () => {
        const rename = vi.spyOn(fs.promises, "rename");
        const document = {metrics: [{name: "non_empty", status_history: [{status: "Pass"}]}]};

        await files.publishQualityControlDocument(tag, document);

        const finalPath = files.qualityControlDocumentPath(tag);

        expect(rename).toHaveBeenCalledTimes(1);
        expect(rename.mock.calls[0][0]).toMatch(new RegExp(`^${finalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\..+\\.tmp$`));
        expect(rename.mock.calls[0][1]).toBe(finalPath);

        expect(await fs.promises.readdir(path.join(directory, "raw"))).toEqual([`nmcp-qc-${tag}.json`]);
        expect(JSON.parse(await fs.promises.readFile(finalPath, "utf8"))).toEqual(document);
    });

    test("removing the QC document deletes it, and resolves when there is none", async () => {
        await files.publishQualityControlDocument(tag, {metrics: []});

        await files.removeQualityControlDocument(tag);

        expect(fs.existsSync(files.qualityControlDocumentPath(tag))).toBe(false);

        await expect(files.removeQualityControlDocument(tag)).resolves.toBeUndefined();
    });
});

describe("rawUploadQualityControlUrl", () => {
    test.each([
        "https://metadata.example.org",
        "https://metadata.example.org/"
    ])("is built from %s with a single slash", (base: string) => {
        CoreServiceOptions.qualityControl.aindMetadataUrl = base;

        expect(files.rawUploadQualityControlUrl(tag)).toBe(`https://metadata.example.org/quality_control?name=nmcp-qc-${tag}`);
    });

    test("is null without a tag or without a base", () => {
        CoreServiceOptions.qualityControl.aindMetadataUrl = "https://metadata.example.org";

        expect(files.rawUploadQualityControlUrl(null)).toBeNull();

        CoreServiceOptions.qualityControl.aindMetadataUrl = "";

        expect(files.rawUploadQualityControlUrl(tag)).toBeNull();
    });
});

describe("postQualityControlDocument", () => {
    const document = {object_type: "Quality control", evaluations: []};
    const location = "s3://bucket/precomputed/nmcp-qc-" + tag;

    test("posts the document, its name and its skeleton location to <base>/metadata-viz/temporary-metadata", async () => {
        CoreServiceOptions.qualityControl.aindMetadataUrl = "https://metadata.example.org/";
        const fetchMock = vi.fn().mockResolvedValue({ok: true, status: 200});
        vi.stubGlobal("fetch", fetchMock);

        await files.postQualityControlDocument(tag, document, location);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("https://metadata.example.org/metadata-viz/temporary-metadata");
        expect(fetchMock.mock.calls[0][1].method).toBe("POST");
        expect(fetchMock.mock.calls[0][1].headers).toEqual({"Content-Type": "application/json"});
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({quality_control: document, name: `nmcp-qc-${tag}`, location});
    });

    test("rejects on a non-OK response", async () => {
        CoreServiceOptions.qualityControl.aindMetadataUrl = "https://metadata.example.org";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, status: 502}));

        await expect(files.postQualityControlDocument(tag, document, location)).rejects.toThrow("502");
    });

    test("rejects without calling fetch when no base is configured", async () => {
        CoreServiceOptions.qualityControl.aindMetadataUrl = "";
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(files.postQualityControlDocument(tag, document, location)).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
