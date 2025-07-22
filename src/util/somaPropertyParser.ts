import * as fs from "fs";
import * as csvParse from "csv-parse";

const debug = require("debug")("nmcp:api:tools:importSomaProperties");

export async function parseSomaPropertyData(filename: string){

    const csvData = fs.readFileSync(filename, 'utf8');

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

    const processedRecords = records.map(record => {
        const processed = {...record};

        if (record.xyz) {
            processed.xyz = parseXyzString(record.xyz);
        }

        const radiiColumn = Object.keys(record).find(key => key.toLowerCase().startsWith('radii'));
        if (radiiColumn && record[radiiColumn]) {
            processed[radiiColumn] = parseXyzString(record[radiiColumn]);
        }

        Object.keys(record).forEach(key => {
            const lowerKey = key.toLowerCase();
            if ((lowerKey.includes('brightness') || lowerKey.includes('volume')) && record[key]) {
                const numValue = parseFloat(record[key]);
                if (!isNaN(numValue)) {
                    processed[key] = numValue;
                }
            }
        });

        return processed;
    });

    debug(`Processed ${processedRecords.length} records from ${filename}`);

    return processedRecords;
}

function parseXyzString(xyzStr: string): {x: number, y: number, z: number} {
    const cleanStr = xyzStr.replace(/[()]/g, '');
    const [x, y, z] = cleanStr.split(',').map(s => parseFloat(s.trim()));
    return {x, y, z};
}

function normalizeColumnName(columnName: string): string {
    return columnName
        .trim()
        .replace(/\([^)]*\)/g, '')
        .trim()
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((word, index) => {
            if (index === 0) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join('');
}
