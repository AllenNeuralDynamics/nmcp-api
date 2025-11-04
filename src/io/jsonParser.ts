import * as byline from "byline";
import * as fs from "fs";
import JSONStream = require("JSONStream");
import {SimpleNode, SimpleNeuronStructure} from "./parsedReconstruction";
import {AtlasStructure} from "../models/atlasStructure";
import {AxonStructureId, DendriteStructureId} from "../models/tracingStructure";

const debug = require("debug")("nmcp:nmcp-api:json-parser");

export async function jsonChunkParse(fileStream: fs.ReadStream): Promise<[SimpleNeuronStructure, SimpleNeuronStructure]> {
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

export async function jsonParse(fileStream: fs.ReadStream): Promise<[SimpleNeuronStructure, SimpleNeuronStructure]> {
    const stream = byline.createStream(fileStream);

    let data: string = "";

    return new Promise((resolve, reject) => {
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
            oneFileComplete(data, resolve, reject);
        });
    });
}

function oneFileComplete(data: string, resolve, reject) {
    try {
        const obj = JSON.parse(data);

        const [axonData, dendriteData] = parseObj(obj.neurons[0]);

        if (obj["comment"]) {
            axonData.addComment(obj["comment"]);
            dendriteData.addComment(obj["comment"]);
        }

        resolve([axonData, dendriteData]);
    } catch (err) {
        reject(err);
    }
}

function parseObj(obj: any): [SimpleNeuronStructure, SimpleNeuronStructure] {
    const axonData = createNeuronStructure(AxonStructureId, obj.axon);

    if (axonData) {
        axonData.finalize();
    }

    const dendriteData = createNeuronStructure(DendriteStructureId, obj.dendrite)

    if (dendriteData) {
        dendriteData.finalize();
    }

    return [axonData, dendriteData];
}

function createNeuronStructure(neuronStructureId: string, nodes: any[]): SimpleNeuronStructure {
    if (!nodes) {
        return null;
    }
    const data = new SimpleNeuronStructure(neuronStructureId);

    const samples = parseSamples(nodes);

    samples.forEach(n => {
        data.addSample(n);
    });

    return data;
}

function parseSamples(nodes: any[]): SimpleNode[] {
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
            brainStructureId: AtlasStructure.getFromStructureId(n.allenId)?.id
        };
    });
}
