import * as csvParse from "csv-parse";

import {Atlas} from "../models/atlas";
import {NeuronShape, SomaLocation, SomaProperties} from "../models/neuron";

const debug = require("debug")("nmcp:api:tools:importSomaProperties");

export async function parseSomaPropertySteam(stream: NodeJS.ReadableStream, specimenId: string, atlas: Atlas, performAtlasLookup: boolean): Promise<NeuronShape[]> {
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

    debug(`processed ${records.length} records from stream`);

    return parseSomaPropertyRecords(records, specimenId, atlas, performAtlasLookup);
}

async function parseSomaPropertyRecords(records: any[], specimenId: string, atlas: Atlas, performAtlasLookup: boolean): Promise<NeuronShape[]> {
    return records.map(record => {
        const processed: NeuronShape = {
            keywords: [],
            specimenSoma: null,
            atlasSoma: null,
            somaProperties: null,
            atlasStructureId: null,
            specimenId: specimenId
        };

        if (record.xyzRaw) {
            processed.specimenSoma = parseXyzString(record.xyzRaw);
        }

        if (record.xyzCcfAuto) {
            processed.atlasSoma = parseXyzString(record.xyzCcfAuto);
            if (performAtlasLookup) {
                processed.atlasStructureId = atlas.findForLocation(processed.atlasSoma, false);
            }
        }

        const somaProperties: SomaProperties = {
            brightness: 0,
            volume: 0,
            radii: {
                x: 0,
                y: 0,
                z: 0
            }
        };

        const radiiColumn = Object.keys(record).find(key => key.toLowerCase().startsWith("radii"));

        if (radiiColumn && record[radiiColumn]) {
            somaProperties.radii = parseXyzString(record[radiiColumn]);
        }

        Object.keys(record).forEach(key => {
            const lowerKey = key.toLowerCase();
            if ((lowerKey.includes("brightness") || lowerKey.includes("volume")) && record[key]) {
                const numValue = parseFloat(record[key]);
                if (!isNaN(numValue)) {
                    somaProperties[key] = numValue;
                }
            }
        });

        processed.somaProperties = somaProperties;

        return processed;
    });
}

function parseXyzString(xyzStr: string): SomaLocation {
    const cleanStr = xyzStr.replace(/[()]/g, "");
    const [x, y, z] = cleanStr.split(",").map(s => parseFloat(s.trim()));
    return {x, y, z};
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
