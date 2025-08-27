import * as byline from "byline";
import * as fs from "fs";
import {StructureIdentifiers} from "../models/structureIdentifier";
import {ParsedReconstruction} from "./parsedReconstruction";

/**
 * Parse a SWC file and calculate branch/end points and lengths between nodes.
 *
 * @param fileStream readable SWC filestream
 */
export async function swcParse(fileStream: fs.ReadStream): Promise<ParsedReconstruction> {
    const stream = byline.createStream(fileStream);

    const swcData = new ParsedReconstruction();

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

function oneSwcLine(line: string, swcData: ParsedReconstruction) {
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

    const sampleNumber = parseInt(data[0]);
    const parentNumber = parseInt(data[6]);

    if (isNaN(sampleNumber) || isNaN(parentNumber)) {
        return;
    }

    let structure = parseInt(data[1]);

    if (parentNumber === -1) {
        if (structure !== StructureIdentifiers.soma) {
            swcData.addComment(`# Un-parented (root) sample ${sampleNumber} converted from ${structure} to soma (${StructureIdentifiers.soma})`);
            structure = StructureIdentifiers.soma;
        }
    }

    swcData.addSample({
        sampleNumber: sampleNumber,
        parentNumber: parentNumber,
        structure: structure,
        x: swcData.offsetX + parseFloat(data[2]),
        y: swcData.offsetY + parseFloat(data[3]),
        z: swcData.offsetZ + parseFloat(data[4]),
        radius: parseFloat(data[5]),
        lengthToParent: 0,
        brainStructureId: null
    });
}

function oneSwcFileComplete(swcData: ParsedReconstruction, resolve) {
    swcData.finalize();

    resolve(swcData);
}
