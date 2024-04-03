import * as byline from "byline";
import * as fs from "fs";
import {ISwcSample, SwcData} from "./SwcParser";

export async function jsonParse(fileStream: fs.ReadStream): Promise<[SwcData, SwcData]> {
    const stream = byline.createStream(fileStream);

    let data: string = "";

    return new Promise((resolve) => {
        stream.on("readable", () => {
            let line: Buffer;
            while ((line = stream.read()) !== null) {
                data += line.toString("utf8");
            }
        });
        stream.on("end", () => {
            oneFileComplete(data, resolve);
        });
    });
}

function oneFileComplete(data: string, resolve) {
    const obj = JSON.parse(data);

    const axonData = createSwcData(obj.neurons[0].axon);

    if (axonData) {
        axonData.finalize();
    }

    const dendriteData = createSwcData(obj.neurons[0].dendrite)

    if (dendriteData) {
        dendriteData.finalize();
    }

    resolve([axonData, dendriteData]);
}

function createSwcData(nodes: any[]): SwcData {
    if (!nodes) {
        return null;
    }
    const axonData = new SwcData();

    const samples = parseSamples(nodes);

    samples.forEach(n => {
        axonData.addSample(n);
    });

    return axonData;
}

function parseSamples(nodes: any[]): ISwcSample[] {
    return nodes.map((n: any) => {
        return {
            sampleNumber: n.sampleNumber,
            parentNumber: n.parentNumber,
            structure: n.structureIdentifier,
            x: n.z,
            y: n.y,
            z: n.x,
            radius: n.radius,
            lengthToParent: 0
        };
    });
}
