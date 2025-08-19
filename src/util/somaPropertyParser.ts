import * as fs from "fs";
import * as csvParse from "csv-parse";
import {findBrainStructure} from "../transform/atlasLookupService";

const debug = require("debug")("nmcp:api:tools:importSomaProperties");

export type SomaPropertyRecord = {
    xyz: { x: number, y: number, z: number } | null;
    ccfxyz: { x: number, y: number, z: number } | null;
    tag: string | null;
    somaCompartment: string | null;
    brightness: number | null;
    volume: number | null;
}

export async function parseSomaPropertyFile(filename: string) {

    const csvData = fs.readFileSync(filename, "utf8");

    const records = await new Promise<any[]>((resolve, reject) => {
        csvParse(csvData, {
            columns: (header) => header.map(normalizeColumnName),
            skip_empty_lines: true
        }, (err, output) => {
            if (err) {
                reject(err);
            } else {
                resolve(output);
            }
        });
    });

    debug(`Processed ${records.length} records from ${filename}`);

    return parseSomaPropertyRecords(records);
}

export async function parseSomaPropertySteam(stream: NodeJS.ReadableStream) {

    const records = await new Promise<any[]>((resolve, reject) => {
        const parser = csvParse({
            columns: (header) => header.map(normalizeColumnName),
            skip_empty_lines: true
        });

        const results: any[] = [];

        parser.on("readable", function () {
            let record: any;
            while (record = parser.read()) {
                results.push(record);
            }
        });

        parser.on("error", function (err) {
            reject(err);
        });

        parser.on("end", function () {
            resolve(results);
        });

        stream.pipe(parser);
    });

    debug(`Processed ${records.length} records from stream`);

    return parseSomaPropertyRecords(records);
}

async function parseSomaPropertyRecords(records: any[]): Promise<SomaPropertyRecord[]> {
    const processedRecords = records.map(record => {
        const processed: SomaPropertyRecord = {
            xyz: null,
            ccfxyz: null,
            tag: null,
            somaCompartment: null,
            brightness: null,
            volume: null
        };

        if (record.xyzRaw) {
            processed.xyz = parseXyzString(record.xyzRaw);
        }


        if (record.xyzCcf) {
            processed.ccfxyz = parseXyzString(record.xyzCcf);

            if (processed.ccfxyz) {
                processed.somaCompartment = findBrainStructure(processed.ccfxyz);
            }
        }

        const radiiColumn = Object.keys(record).find(key => key.toLowerCase().startsWith("radii"));
        if (radiiColumn && record[radiiColumn]) {
            processed[radiiColumn] = parseXyzString(record[radiiColumn]);
        }

        Object.keys(record).forEach(key => {
            const lowerKey = key.toLowerCase();
            if ((lowerKey.includes("brightness") || lowerKey.includes("volume")) && record[key]) {
                const numValue = parseFloat(record[key]);
                if (!isNaN(numValue)) {
                    processed[key] = numValue;
                }
            }
        });

        return processed;
    });

    return processedRecords;
}

function parseXyzString(xyzStr: string): { x: number, y: number, z: number } {
    const cleanStr = xyzStr.replace(/[()]/g, "");
    const [x, y, z] = cleanStr.split(",").map(s => parseFloat(s.trim()));
    return {x: z, y: y, z: x};
}

function normalizeColumnName(columnName: string): string {
    return columnName
        .trim()
        .replace(/\([^)]*\)/g, "")
        .trim()
        .replace(/[^a-zA-Z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .split(" ")
        .map((word, index) => {
            if (index === 0) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join("");
}
