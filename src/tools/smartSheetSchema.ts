import * as fs from "fs";
import * as path from "path";

import {Column, createClient, Row, Sheet} from "smartsheet";
import moment = require("moment");

const maxSampleCount = 10;
const maxSampleLength = 120;
// Columns with at most this many distinct values list every one of them rather than a sample.
const maxCompleteValueCount = 50;

// Smartsheet reports a formula failure as the cell value itself (e.g., "#BLOCKED", "#INCORRECT ARGUMENT SET"), not as an error.
const formulaErrorPattern = /^#[A-Z][A-Z -]*$/;

type ValueCount = {
    value: string;
    count: number;
    // Sheet row number of the first occurrence.
    firstRow: number;
}

type RawValueCount = ValueCount & {
    raw: string;
}

type ColumnStatistics = {
    nonEmptyCount: number;
    distinctCount: number;
    // Counts by typeof of the raw cell value, which can differ from the declared column type (e.g., numbers in a TEXT_NUMBER column).
    valueTypes: Record<string, number>;
    formulaErrorCount?: number;
    // Cells with a formula of their own, other than the column formula.
    cellFormulaCount?: number;
    // Displayed text, most frequent first.  Complete when values.length == distinctCount, otherwise the most frequent maxSampleCount.
    values: ValueCount[];
    // Cells whose raw value differs from the displayed text (e.g., a contact's email behind the name).  Code reading cell.value sees raw.
    rawValues?: RawValueCount[];
}

// Hierarchical sheets usually hold a different entity at each level (e.g., specimen rows parenting neuron rows), and an importer reads
// the same column differently for each, so statistics are kept per group.  "Has children" matches the common
// =IF(COUNT(CHILDREN()) > 0, 1, 0) level column.
type RowGroup = "allRows" | "parentRows" | "leafRows";

type RowGroups = Partial<Record<RowGroup, Row[]>>;

type ColumnSchema = {
    index: number;
    id: number;
    title: string;
    type: string;
    primary?: boolean;
    systemColumnType?: string;
    symbol?: string;
    options?: string[];
    validation?: boolean;
    formula?: string;
    description?: string;
    hidden?: boolean;
    statistics: Partial<Record<RowGroup, ColumnStatistics>>;
}

type SheetSchema = {
    sheetId: number;
    sheetName: string;
    retrievedAt: string;
    rowCount: number;
    rowGroupCounts: Partial<Record<RowGroup, number>>;
    columns: ColumnSchema[];
}

type SchemaFile = {
    sheets: SheetSchema[];
}

function truncate(text: string): string {
    return text.length > maxSampleLength ? `${text.substring(0, maxSampleLength)}…` : text;
}

function countValue<T extends ValueCount>(counts: Map<string, T>, key: string, entry: T) {
    const existing = counts.get(key);

    if (existing) {
        existing.count++;
    } else {
        counts.set(key, entry);
    }
}

function mostFrequent<T extends ValueCount>(counts: Map<string, T>, limit: number): T[] {
    // Array.prototype.sort is stable, so equally frequent values stay in sheet order.
    return Array.from(counts.values()).sort((lhs, rhs) => rhs.count - lhs.count).slice(0, limit);
}

function columnStatistics(column: Column, rows: Row[]): ColumnStatistics {
    const values = new Map<string, ValueCount>();
    const rawValues = new Map<string, RawValueCount>();
    const valueTypes: Record<string, number> = {};
    let nonEmptyCount = 0;
    let formulaErrorCount = 0;
    let cellFormulaCount = 0;

    for (const row of rows) {
        const cell = row.cells.find(candidate => candidate.columnId == column.id);

        if (!cell) {
            continue;
        }

        if (cell.formula && cell.formula != column.formula) {
            cellFormulaCount++;
        }

        if (cell.value === undefined || cell.value === null || cell.value === "") {
            continue;
        }

        nonEmptyCount++;

        const valueType = typeof cell.value;
        valueTypes[valueType] = (valueTypes[valueType] ?? 0) + 1;

        const raw = truncate(String(cell.value));
        const display = cell.displayValue !== undefined && cell.displayValue !== null ? truncate(cell.displayValue) : raw;

        if (formulaErrorPattern.test(display)) {
            formulaErrorCount++;
        }

        countValue(values, display, {value: display, count: 1, firstRow: row.rowNumber});

        if (raw != display) {
            countValue(rawValues, `${display}\u0000${raw}`, {value: display, raw, count: 1, firstRow: row.rowNumber});
        }
    }

    return {
        nonEmptyCount,
        distinctCount: values.size,
        valueTypes,
        formulaErrorCount: formulaErrorCount || undefined,
        cellFormulaCount: cellFormulaCount || undefined,
        values: mostFrequent(values, values.size <= maxCompleteValueCount ? values.size : maxSampleCount),
        rawValues: rawValues.size > 0 ? mostFrequent(rawValues, maxSampleCount) : undefined
    };
}

function rowGroups(sheet: Sheet): RowGroups {
    const parentIds = new Set(sheet.rows.map(row => row.parentId).filter(parentId => parentId !== undefined && parentId !== null));

    if (parentIds.size == 0) {
        return {allRows: sheet.rows};
    }

    return {
        parentRows: sheet.rows.filter(row => parentIds.has(row.id)),
        leafRows: sheet.rows.filter(row => !parentIds.has(row.id))
    };
}

function columnSchema(column: Column, groups: RowGroups): ColumnSchema {
    return {
        index: column.index,
        id: column.id,
        title: column.title,
        type: column.type,
        primary: column.primary || undefined,
        systemColumnType: column.systemColumnType,
        symbol: column.symbol,
        options: column.options,
        validation: column.validation || undefined,
        formula: column.formula,
        description: column.description,
        hidden: column.hidden || undefined,
        statistics: Object.fromEntries(Object.entries(groups).map(([group, rows]) => [group, columnStatistics(column, rows)]))
    };
}
async function smartSheetSchema(sheetId: number): Promise<string> {
    const token = process.env.SS_API_TOKEN;

    if (!token) {
        throw new Error("SmartSheet access token required (SS_API_TOKEN).");
    }

    const client = createClient({logLevel: "warn", accessToken: token});

    const sheet: Sheet = await client.sheets.getSheet({id: sheetId});

    const groups = rowGroups(sheet);

    const schema: SheetSchema = {
        sheetId,
        sheetName: sheet.name,
        retrievedAt: new Date().toISOString(),
        rowCount: sheet.rows.length,
        rowGroupCounts: Object.fromEntries(Object.entries(groups).map(([group, rows]) => [group, rows.length])),
        columns: sheet.columns.map(column => columnSchema(column, groups))
    };

    const outputDirectory = path.join(__dirname, "schemas");
    const outputPath = path.join(outputDirectory, `smartSheets-${moment().format("YYYY-MM-DD")}.json`);

    fs.mkdirSync(outputDirectory, {recursive: true});

    // Running against several sheets on the same day accumulates them in one file; re-running a sheet replaces its entry.
    let contents: SchemaFile = {sheets: []};

    if (fs.existsSync(outputPath)) {
        contents = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    }

    contents.sheets = contents.sheets.filter(existing => existing.sheetId !== sheetId);
    contents.sheets.push(schema);

    fs.writeFileSync(outputPath, JSON.stringify(contents, null, 2) + "\n");

    return outputPath;
}

const cliArguments = process.argv.slice(2);

if (cliArguments.length < 1 || isNaN(parseInt(cliArguments[0]))) {
    console.error("SmartSheet sheet numeric id required.");
    process.exit(-1);
}

smartSheetSchema(parseInt(cliArguments[0])).then(outputPath => console.log(`Sheet schema written to ${outputPath}`)).catch(error => {
    console.error(error.message);
    process.exit(-1);
});
