import {NodeStructures} from "../models/nodeStructure";
import {buildSimpleReconstruction, SimpleReconstruction, SimpleReconstructionRow} from "./simpleReconstruction";

const debug = require("debug")("nmcp:nmcp-api:parquet-parser");

export const ParquetReconstructionColumns = {
    index: "id",
    structure: "type",
    x: "x",
    y: "y",
    z: "z",
    radius: "radius",
    parentIndex: "parent",
    atlasStructure: "locationId"
};

const requiredColumns = ["index", "structure", "x", "y", "z", "radius", "parentIndex"] as const;

async function loadParquetLibrary(): Promise<any> {
    // See loadHyparquet.mjs for why hyparquet is loaded through an untranspiled ESM helper.
    // @ts-ignore - no type declarations for the .mjs helper
    const {loadHyparquet} = await import("./loadHyparquet.mjs");
    return loadHyparquet();
}

function toSafeInteger(value: unknown, columnName: string, rowIndex: number): number {
    if (typeof value === "bigint") {
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
            throw new Error(`Row ${rowIndex}: ${columnName} value ${value} exceeds safe integer range`);
        }
        return Number(value);
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
            throw new Error(`Row ${rowIndex}: ${columnName} value ${value} is not a safe integer`);
        }
        return value;
    }

    throw new Error(`Row ${rowIndex}: ${columnName} has unexpected type ${typeof value}`);
}

function toFiniteNumber(value: unknown, columnName: string, rowIndex: number): number {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Row ${rowIndex}: ${columnName} value ${value} is not a finite number`);
        }
        return value;
    }

    if (typeof value === "bigint") {
        return toSafeInteger(value, columnName, rowIndex);
    }

    throw new Error(`Row ${rowIndex}: ${columnName} has unexpected type ${typeof value}`);
}

function normalizeParquetRow(row: Record<string, unknown>, rowIndex: number): SimpleReconstructionRow | null {
    const col = ParquetReconstructionColumns;

    for (const key of requiredColumns) {
        const columnName = col[key];
        if (row[columnName] === undefined || row[columnName] === null) {
            throw new Error(`Row ${rowIndex}: required column "${columnName}" is missing or null`);
        }
    }

    const index = toSafeInteger(row[col.index], col.index, rowIndex);
    const parentIndex = toSafeInteger(row[col.parentIndex], col.parentIndex, rowIndex);
    let structure = toSafeInteger(row[col.structure], col.structure, rowIndex);
    const x = toFiniteNumber(row[col.x], col.x, rowIndex);
    const y = toFiniteNumber(row[col.y], col.y, rowIndex);
    const z = toFiniteNumber(row[col.z], col.z, rowIndex);
    const radius = toFiniteNumber(row[col.radius], col.radius, rowIndex);

    let atlasStructure: number | null = null;
    const locationIdValue = row[col.atlasStructure];
    if (locationIdValue !== null && locationIdValue !== undefined) {
        atlasStructure = toSafeInteger(locationIdValue, col.atlasStructure, rowIndex);
    }

    if (!(structure in NodeStructures) || structure === NodeStructures.forkPoint || structure === NodeStructures.endPoint) {
        if (parentIndex !== -1) {
            debug(`Row ${rowIndex}: skipping node with unsupported structure value ${structure}`);
            return null;
        }
    }

    return {
        index,
        parentIndex,
        structure,
        x,
        y,
        z,
        radius,
        atlasStructure
    };
}

function normalizeParquetRows(objectRows: Record<string, unknown>[]): { rows: SimpleReconstructionRow[], comments: string } {
    const rows: SimpleReconstructionRow[] = [];
    let comments = "";

    for (let rowIndex = 0; rowIndex < objectRows.length; rowIndex++) {
        const normalized = normalizeParquetRow(objectRows[rowIndex], rowIndex);

        if (!normalized) {
            continue;
        }

        if (normalized.parentIndex === -1 && normalized.structure !== NodeStructures.soma) {
            comments += `# Un-parented (root) node ${normalized.index} converted from ${normalized.structure} to soma (${NodeStructures.soma})\n`;
            normalized.structure = NodeStructures.soma;
        }

        rows.push(normalized);
    }

    return {rows, comments};
}

export async function parseParquetFile(source: string, parquetFile: string): Promise<SimpleReconstruction> {
    const {parquetReadObjects, asyncBufferFromFile} = await loadParquetLibrary();

    const file = await asyncBufferFromFile(parquetFile);

    const objectRows = await parquetReadObjects({
        file,
        columns: Object.values(ParquetReconstructionColumns)
    }) as Record<string, unknown>[];

    const {rows, comments} = normalizeParquetRows(objectRows);

    return buildSimpleReconstruction(source, rows, comments);
}

export async function parseParquetUpload(source: string, stream: NodeJS.ReadableStream): Promise<SimpleReconstruction> {
    const {parquetReadObjects} = await loadParquetLibrary();

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    // ArrayBuffer satisfies hyparquet's AsyncBuffer interface (byteLength + slice)
    const file = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const objectRows = await parquetReadObjects({
        file,
        columns: Object.values(ParquetReconstructionColumns)
    }) as Record<string, unknown>[];

    const {rows, comments} = normalizeParquetRows(objectRows);

    return buildSimpleReconstruction(source, rows, comments);
}
