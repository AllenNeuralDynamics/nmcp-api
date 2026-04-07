import * as fs from "fs";
import JSONStream = require("JSONStream");

import {NeuronStructure} from "../models/neuronStructure";
import {SimpleNeuronStructure} from "./simpleReconstruction";
import {PortalNode} from "./portalFormat";


export async function jsonChunkParse(fileStream: fs.ReadStream): Promise<[SimpleNeuronStructure, SimpleNeuronStructure]> {
    const parser = JSONStream.parse("neurons.*"); // Parses each element in an array or root object

    fileStream.pipe(parser);

    return new Promise((resolve, reject) => {
        let axon = null;
        let dendrite = null;
        parser.on("data", (chunk) => {
            if (chunk.axon && chunk.dendrite) {
                axon = chunk.axon;
                dendrite = chunk.dendrite;
            } else {
                reject(new Error("Invalid JSON structure: Expected 'axon' and 'dendrite' properties."));
            }
        });

        parser.on("end", () => {
            // debug("finished chunk parsing JSON");
            resolve(parseObj({axon: axon, dendrite: dendrite}));
        });

        parser.on("error", (err: any) => {
            reject(new Error(`Error parsing JSON: ${err}`));
        });
    });
}

function parseObj(obj: any): [SimpleNeuronStructure, SimpleNeuronStructure] {
    const axonData = createNeuronStructure(NeuronStructure.AxonStructureId, obj.axon);

    if (axonData) {
        axonData.finalize();
    }

    const dendriteData = createNeuronStructure(NeuronStructure.DendriteStructureId, obj.dendrite)

    if (dendriteData) {
        dendriteData.finalize();
    }

    return [axonData, dendriteData];
}

function createNeuronStructure(neuronStructureId: string, jsonNodes: any[]): SimpleNeuronStructure {
    if (!jsonNodes) {
        return null;
    }
    const data = new SimpleNeuronStructure(neuronStructureId);

    const nodes = parseNodes(jsonNodes);

    nodes.forEach(n => {
        data.addNode(n);
    });

    return data;
}

function parseNodes(nodes: any[]): PortalNode[] {
    return nodes.map((n: any) => {
        return {
            index: n.sampleNumber,
            parentIndex: n.parentNumber,
            structure: n.structureIdentifier,
            x: n.x,
            y: n.y,
            z: n.z,
            radius: n.radius,
            lengthToParent: n.lengthToParent ?? 0,
            atlasStructureId: n.allenId
        };
    });
}
