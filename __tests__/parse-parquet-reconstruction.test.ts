import {expect, test, beforeAll, describe} from "vitest";
import {Readable} from "node:stream";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {RemoteDatabaseClient} from "../src/data-access/remoteDatabaseClient";
import {parseParquetFile, parseParquetUpload, ParquetReconstructionColumns} from "../src/io/parquetParser";

let client: RemoteDatabaseClient = null;

beforeAll(async () => {
    client = await RemoteDatabaseClient.Start(false, false, true);
    return client;
});

async function writeTestParquet(columnData: any[]): Promise<ArrayBuffer> {
    const {parquetWriteBuffer} = await import("hyparquet-writer") as any;
    return parquetWriteBuffer({columnData});
}

function arrayBufferToStream(buffer: ArrayBuffer): Readable {
    return Readable.from(Buffer.from(buffer));
}

// Matches the SWC fixture structure: 1 soma, 2 axon, 4 dendrite nodes
function buildStandardColumns() {
    const col = ParquetReconstructionColumns;
    return [
        {name: col.index, data: BigInt64Array.from([1n, 2n, 3n, 4n, 5n, 6n, 7n]), type: "INT64" as const},
        {name: col.structure, data: BigInt64Array.from([1n, 2n, 2n, 3n, 3n, 3n, 3n]), type: "INT64" as const},
        {name: col.x, data: Float64Array.from([32250.81, 32249.27, 32254.15, 14654.23, 14646.73, 14639.23, 14630.65]), type: "DOUBLE" as const},
        {name: col.y, data: Float64Array.from([10519.88, 10518.93, 10512.31, 16020.24, 16019.80, 16019.36, 16017.78]), type: "DOUBLE" as const},
        {name: col.z, data: Float64Array.from([11403.17, 11403.59, 11404.25, 12527.19, 12523.43, 12519.66, 12518.35]), type: "DOUBLE" as const},
        {name: col.radius, data: Float64Array.from([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]), type: "DOUBLE" as const},
        {name: col.parentIndex, data: BigInt64Array.from([-1n, 1n, 2n, 1n, 4n, 5n, 6n]), type: "INT64" as const},
        {name: col.atlasStructure, data: [null, null, null, null, null, null, null], type: "INT64" as const, nullable: true}
    ];
}

describe("Parquet parser", () => {
    test("parses a valid Parquet upload with correct node counts", async () => {
        const buffer = await writeTestParquet(buildStandardColumns());
        const stream = arrayBufferToStream(buffer);

        const reconstruction = await parseParquetUpload("test.parquet", stream);

        expect(reconstruction.source).toBe("test.parquet");
        expect(reconstruction.comments).toBe("");

        expect(reconstruction.axon.soma).toBeDefined();
        expect(reconstruction.axon.nodeCount).toBe(2);

        expect(reconstruction.dendrite.soma).toBeDefined();
        expect(reconstruction.dendrite.nodeCount).toBe(4);
    });

    test("parses a valid Parquet file from disk", async () => {
        const buffer = await writeTestParquet(buildStandardColumns());
        const tmpFile = path.join(os.tmpdir(), `test-reconstruction-${Date.now()}.parquet`);

        try {
            fs.writeFileSync(tmpFile, Buffer.from(buffer));

            const reconstruction = await parseParquetFile("file-test.parquet", tmpFile);

            expect(reconstruction.source).toBe("file-test.parquet");
            expect(reconstruction.axon.soma).toBeDefined();
            expect(reconstruction.axon.nodeCount).toBe(2);
            expect(reconstruction.dendrite.soma).toBeDefined();
            expect(reconstruction.dendrite.nodeCount).toBe(4);
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    test("calculates branch/end/path counts and lengthToParent", async () => {
        const buffer = await writeTestParquet(buildStandardColumns());
        const stream = arrayBufferToStream(buffer);

        const reconstruction = await parseParquetUpload("test.parquet", stream);

        expect(reconstruction.axon.endCount).toBe(1);
        expect(reconstruction.axon.pathCount).toBe(1);
        expect(reconstruction.axon.branchCount).toBe(0);

        expect(reconstruction.dendrite.endCount).toBe(1);
        expect(reconstruction.dendrite.pathCount).toBe(3);
        expect(reconstruction.dendrite.branchCount).toBe(0);

        const axonNodes = reconstruction.axon.getNonSomaNodes();
        const nodesWithLength = axonNodes.filter(node => node.lengthToParent > 0);
        expect(nodesWithLength.length).toBeGreaterThan(0);
    });

    test("preserves locationId as atlasStructure", async () => {
        const col = ParquetReconstructionColumns;
        const columns = [
            {name: col.index, data: BigInt64Array.from([1n, 2n]), type: "INT64" as const},
            {name: col.structure, data: BigInt64Array.from([1n, 2n]), type: "INT64" as const},
            {name: col.x, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.y, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.z, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.radius, data: Float64Array.from([1.0, 1.0]), type: "DOUBLE" as const},
            {name: col.parentIndex, data: BigInt64Array.from([-1n, 1n]), type: "INT64" as const},
            {name: col.atlasStructure, data: [null, 997n], type: "INT64" as const, nullable: true}
        ];

        const buffer = await writeTestParquet(columns);
        const stream = arrayBufferToStream(buffer);

        const reconstruction = await parseParquetUpload("atlas-test.parquet", stream);

        const axonNodes = reconstruction.axon.getNonSomaNodes();
        expect(axonNodes.length).toBe(1);
        expect(axonNodes[0].atlasStructure).toBe(997);
    });

    test("accepts bigint values within safe integer range", async () => {
        const col = ParquetReconstructionColumns;
        const columns = [
            {name: col.index, data: BigInt64Array.from([1n, 2n]), type: "INT64" as const},
            {name: col.structure, data: BigInt64Array.from([1n, 2n]), type: "INT64" as const},
            {name: col.x, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.y, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.z, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.radius, data: Float64Array.from([1.0, 1.0]), type: "DOUBLE" as const},
            {name: col.parentIndex, data: BigInt64Array.from([-1n, 1n]), type: "INT64" as const},
            {name: col.atlasStructure, data: [null, null], type: "INT64" as const, nullable: true}
        ];

        const buffer = await writeTestParquet(columns);
        const stream = arrayBufferToStream(buffer);

        const reconstruction = await parseParquetUpload("bigint-test.parquet", stream);
        expect(reconstruction.axon.soma).toBeDefined();
        expect(reconstruction.axon.nodeCount).toBe(1);
    });

    test("converts un-parented non-soma root to soma with comment", async () => {
        const col = ParquetReconstructionColumns;
        // Root node (parent=-1) with structure=2 (axon) should be converted to soma
        const columns = [
            {name: col.index, data: BigInt64Array.from([1n, 2n]), type: "INT64" as const},
            {name: col.structure, data: BigInt64Array.from([2n, 2n]), type: "INT64" as const},
            {name: col.x, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.y, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.z, data: Float64Array.from([100.0, 200.0]), type: "DOUBLE" as const},
            {name: col.radius, data: Float64Array.from([1.0, 1.0]), type: "DOUBLE" as const},
            {name: col.parentIndex, data: BigInt64Array.from([-1n, 1n]), type: "INT64" as const},
            {name: col.atlasStructure, data: [null, null], type: "INT64" as const, nullable: true}
        ];

        const buffer = await writeTestParquet(columns);
        const stream = arrayBufferToStream(buffer);

        const reconstruction = await parseParquetUpload("root-convert.parquet", stream);

        expect(reconstruction.axon.soma).toBeDefined();
        expect(reconstruction.comments).toContain("Un-parented (root) node 1 converted from 2 to soma");
    });

    test("throws on missing required column", async () => {
        const col = ParquetReconstructionColumns;
        // Missing radius column
        const columns = [
            {name: col.index, data: BigInt64Array.from([1n]), type: "INT64" as const},
            {name: col.structure, data: BigInt64Array.from([1n]), type: "INT64" as const},
            {name: col.x, data: Float64Array.from([100.0]), type: "DOUBLE" as const},
            {name: col.y, data: Float64Array.from([100.0]), type: "DOUBLE" as const},
            {name: col.z, data: Float64Array.from([100.0]), type: "DOUBLE" as const},
            {name: col.parentIndex, data: BigInt64Array.from([-1n]), type: "INT64" as const},
            {name: col.atlasStructure, data: [null], type: "INT64" as const, nullable: true}
        ];

        const buffer = await writeTestParquet(columns);
        const stream = arrayBufferToStream(buffer);

        await expect(parseParquetUpload("missing-col.parquet", stream))
            .rejects.toThrow("radius");
    });
});
