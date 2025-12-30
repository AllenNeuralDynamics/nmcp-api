import * as byline from "byline";
import * as fs from "fs";
import {NodeStructures} from "../models/nodeStructure";

import {SimpleNeuronStructure, SimpleReconstruction} from "./simpleReconstruction";
import {NeuronStructure} from "../models/neuronStructure";

const debug = require("debug")("nmcp:nmcp-api:swc-parser");

/**
 * Parse a SWC file and calculate branch/end points and lengths between nodes.
 *
 * @param source source url for the stream
 * @param fileStream readable SWC filestream
 */
export async function swcParse(source: string, fileStream: fs.ReadStream): Promise<SimpleReconstruction> {
    const stream = byline.createStream(fileStream);

    const reconstruction: SimpleReconstruction = {
        source: source,
        comments: "",
        axon: new SimpleNeuronStructure(NeuronStructure.AxonStructureId),
        dendrite: new SimpleNeuronStructure(NeuronStructure.DendriteStructureId)
    };

    return new Promise<SimpleReconstruction>((resolve) => {
        stream.on("readable", () => {
            let line: Buffer;
            while ((line = stream.read()) !== null) {
                const lineContent = line.toString("utf8");

                if (lineContent.length == 0) {
                    continue;
                }

                if (lineContent[0] === "#") {
                    reconstruction.comments += lineContent + "\n";
                }

                parseNode(reconstruction, lineContent);
            }
        });
        stream.on("end", () => {
            oneSwcFileComplete(reconstruction, resolve);
        });
    });
}

function parseNode(reconstruction: SimpleReconstruction, lineContent: string) {
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
            reconstruction.comments += `# Un-parented (root) node ${index} converted from ${structure} to soma (${NodeStructures.soma})`;
            structure = NodeStructures.soma;
        }
    }

    const node = {
        sampleNumber: index,
        parentNumber: parentIndex,
        structureIdentifier: structure,
        x: parseFloat(data[2]),
        y: parseFloat(data[3]),
        z: parseFloat(data[4]),
        radius: parseFloat(data[5]),
        lengthToParent: 0,
        allenId: null
    };

    if (structure == NodeStructures.soma) {
        reconstruction.axon.addNode(node);
        reconstruction.dendrite.addNode(node);
    } else if (structure == NodeStructures.axon) {
        reconstruction.axon.addNode(node);
    } else if (structure == NodeStructures.basalDendrite || structure == NodeStructures.apicalDendrite) {
        reconstruction.dendrite.addNode(node);
    } else {
        debug(`unexpected SWC node structure: ${structure}`);
    }
}

function oneSwcFileComplete(reconstruction: SimpleReconstruction, resolve: (value: (SimpleReconstruction | PromiseLike<SimpleReconstruction>)) => void) {
    reconstruction.axon.finalize();
    reconstruction.dendrite.finalize();

    resolve(reconstruction);
}
