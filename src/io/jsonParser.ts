import * as byline from "byline";
import * as fs from "fs";
import JSONStream = require("JSONStream");
import {ParsedNode, ParsedReconstruction} from "./parsedReconstruction";
import {BrainArea} from "../models/brainArea";

const debug = require("debug")("nmcp:nmcp-api:json-parser");

export async function jsonChunkParse(fileStream: fs.ReadStream): Promise<[ParsedReconstruction, ParsedReconstruction]> {
    const parser = JSONStream.parse('neurons.*'); // Parses each element in an array or root object

    fileStream.pipe(parser);

    return new Promise((resolve, reject) => {
        let axon = null;
        let dendrite = null;
        parser.on('data', (chunk) => {
            if (chunk.axon && chunk.dendrite) {
                axon = chunk.axon;
                dendrite = chunk.dendrite;
            } else {
                reject(new Error("Invalid JSON structure: Expected 'axon' and 'dendrite' properties."));
            }
        });

        parser.on('end', () => {
            // debug("finished chunk parsing JSON");
            resolve(parseObj({axon: axon, dendrite: dendrite}));
        });

        parser.on('error', (err: any) => {
            reject(new Error(`Error parsing JSON: ${err}`));
        });
    });
}

export async function jsonParse(fileStream: fs.ReadStream): Promise<[ParsedReconstruction, ParsedReconstruction]> {
    const stream = byline.createStream(fileStream);

    let data: string = "";

    return new Promise((resolve) => {
        stream.on("readable", () => {
            let line: Buffer;
            while ((line = stream.read()) !== null) {
                try {
                    data += line.toString("utf8");
                } catch (err) {
                    // console.error("Error reading line from stream:", err);
                    // Handle the error as needed, e.g., log it or throw an exception
                    // console.error(line);
                }
            }
        });
        stream.on("end", () => {
            oneFileComplete(data, resolve);
        });
    });
}

function oneFileComplete(data: string, resolve) {
    const obj = JSON.parse(data);

    const [axonData, dendriteData] = parseObj(obj.neurons[0]);

    resolve([axonData, dendriteData]);
}

function parseObj(obj: any): [ParsedReconstruction, ParsedReconstruction] {
    const axonData = createSwcData(obj.axon);

    if (axonData) {
        axonData.finalize();
    }

    const dendriteData = createSwcData(obj.dendrite)

    if (dendriteData) {
        dendriteData.finalize();
    }

    return [axonData, dendriteData];
}

function createSwcData(nodes: any[]): ParsedReconstruction {
    if (!nodes) {
        return null;
    }
    const axonData = new ParsedReconstruction();

    const samples = parseSamples(nodes);

    samples.forEach(n => {
        axonData.addSample(n);
    });

    return axonData;
}

function parseSamples(nodes: any[]): ParsedNode[] {
    return nodes.map((n: any) => {
        return {
            sampleNumber: n.sampleNumber,
            parentNumber: n.parentNumber,
            structure: n.structureIdentifier,
            x: n.x,
            y: n.y,
            z: n.z,
            radius: n.radius,
            lengthToParent: 0,
            brainStructureId: BrainArea.getFromStructureId(n.allenId)?.id
        };
    });
}
