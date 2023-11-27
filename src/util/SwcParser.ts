import * as byline from "byline";
import * as fs from "fs";
import {StructureIdentifier, StructureIdentifiers} from "../models/structureIdentifier";
import {parse} from "csv/lib/sync";

export interface ISwcRow {
    sampleNumber: number;
    parentNumber: number;
    structure: number;
    x: number
    y: number;
    z: number;
    radius: number;
}

export interface ISwcParseResult {
    somaCount: number;
    forcedSomaCount: number;
    rows: Array<ISwcRow>;
    pathCount,
    branchCount,
    endCount,
    comments: string;
}

const SOMA_STRUCTURE_IDENTIFIER_INDEX = 1;

export async function swcParse(stream1: fs.ReadStream): Promise<any> {
    const stream = byline.createStream(stream1);

    let parseOutput: ISwcParseResult = {
        somaCount: 0,
        pathCount: 0,
        branchCount: 0,
        endCount: 0,
        forcedSomaCount: 0,
        rows: [],
        comments: ""
    };

    return new Promise((resolve) => {
        stream.on("readable", () => {
            let line: Buffer;
            while ((line = stream.read()) !== null) {
                onData(line.toString("utf8"), parseOutput);
            }
        });
        stream.on("end", () => {
            onComplete(parseOutput, resolve);
        });
    });
}

function onData(line, parseOutput) {
    let data = line.trim();

    if (data.length > 0) {
        if (data[0] === "#") {
            parseOutput.comments += data + "\n";
        } else {
            data = data.split(/\s/);
            if (data.length === 7) {
                const sampleNumber = parseInt(data[0]);
                const parentNumber = parseInt(data[6]);

                if (isNaN(sampleNumber) || isNaN(parentNumber)) {
                    return;
                }

                let structure = parseInt(data[1]);

                if (parentNumber === -1) {
                    parseOutput.somaCount += 1;

                    if (structure !== StructureIdentifiers.soma) {
                        parseOutput.forcedSomaCount += 1;
                        parseOutput.comments += `# Un-parented (root) sample ${sampleNumber} converted from ${structure} to soma (${StructureIdentifiers.soma})`;
                        structure = StructureIdentifiers.soma;
                    }
                } else {
                    switch (structure) {
                        case StructureIdentifiers.forkPoint:
                            parseOutput.branchCount++;
                            break;
                        case StructureIdentifiers.endPoint:
                            parseOutput.endCount++;
                            break;
                        default:
                            parseOutput.pathCount++;
                    }
                }

                const row = {
                    sampleNumber: sampleNumber,
                    parentNumber: parentNumber,
                    structure: structure,
                    x: parseFloat(data[2]),
                    y: parseFloat(data[3]),
                    z: parseFloat(data[4]),
                    radius: parseFloat(data[5])
                };


                parseOutput.rows.push(row);
            }
        }
    }
}

function onComplete(parseOutput, resolve) {
    resolve(parseOutput);
}
