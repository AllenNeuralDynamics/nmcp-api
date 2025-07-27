import * as fs from "fs";
import * as csvParse from "csv-parse";

const debug = require("debug")("nmcp:api:tools:importSomaProperties");

export async function parseSomaPropertyFile(filename: string) {

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
        
        parser.on('readable', function() {
            let record;
            while (record = parser.read()) {
                results.push(record);
            }
        });
        
        parser.on('error', function(err) {
            reject(err);
        });
        
        parser.on('end', function() {
            resolve(results);
        });
        
        stream.pipe(parser);
    });

    debug(`Processed ${records.length} records from stream`);

    return parseSomaPropertyRecords(records);
}

async function parseSomaPropertyRecords(records: any[]) {
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

    return processedRecords;
}

function parseXyzString(xyzStr: string): { x: number, y: number, z: number } {
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
