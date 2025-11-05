import * as byline from "byline";
import * as fs from "fs";
import {NodeStructures} from "../models/nodeStructure";

import {SimpleNeuronStructure} from "./simpleReconstruction";

/**
 * Parse a SWC file and calculate branch/end points and lengths between nodes.
 *
 * @param neuronStructureId axon or dendrite structure id
 * @param fileStream readable SWC filestream
 */
export async function swcParse(neuronStructureId: string, fileStream: fs.ReadStream): Promise<SimpleNeuronStructure> {
    const stream = byline.createStream(fileStream);

    const swcData = new SimpleNeuronStructure(neuronStructureId);

    return new Promise((resolve) => {
        stream.on("readable", () => {
            let line: Buffer;
            while ((line = stream.read()) !== null) {
                oneSwcLine(line.toString("utf8"), swcData);
            }
        });
        stream.on("end", () => {
            oneSwcFileComplete(swcData, resolve);
        });
    });
}

function oneSwcLine(line: string, swcData: SimpleNeuronStructure) {
    let lineContent = line.trim();

    if (lineContent.length == 0) {
        return;
    }

    if (lineContent[0] === "#") {
        swcData.addComment(lineContent + "\n");

        if (lineContent.startsWith("# OFFSET")) {
            const sub = lineContent.substring(9);
            const points = sub.split(/\s/);
            if (points.length === 3) {
                const x = parseFloat(points[0]);
                const y = parseFloat(points[1]);
                const z = parseFloat(points[2]);

                if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
                    swcData.offsetX = x;
                    swcData.offsetY = y;
                    swcData.offsetZ = z;
                }
            }
        }

        return;
    }

    const data = lineContent.split(/\s/);

    if (data.length != 7) {
        return;
    }

    const index = parseInt(data[0]);
    const parentIndex = parseInt(data[6]);

    if (isNaN(index) || isNaN(parentIndex)) {
        return;
    }

    let structure = parseInt(data[1]);

    if (parentIndex === -1) {
        if (structure !== NodeStructures.soma) {
            swcData.addComment(`# Un-parented (root) node ${index} converted from ${structure} to soma (${NodeStructures.soma})`);
            structure = NodeStructures.soma;
        }
    }

    swcData.addNode({
        sampleNumber: index,
        parentNumber: parentIndex,
        structureIdentifier: structure,
        x: swcData.offsetX + parseFloat(data[2]),
        y: swcData.offsetY + parseFloat(data[3]),
        z: swcData.offsetZ + parseFloat(data[4]),
        radius: parseFloat(data[5]),
        lengthToParent: 0,
        allenId: null
    });
}

function oneSwcFileComplete(swcData: SimpleNeuronStructure, resolve) {
    swcData.finalize();

    resolve(swcData);
}
