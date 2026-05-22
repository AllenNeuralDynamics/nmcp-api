import * as byline from "byline";
import * as fs from "fs";
import {NodeStructures} from "../models/nodeStructure";

import {buildSimpleReconstruction, SimpleReconstruction, SimpleReconstructionRow} from "./simpleReconstruction";

const debug = require("debug")("nmcp:nmcp-api:swc-parser");

/**
 * Parse a SWC file and calculate branch/end points and lengths between nodes.
 *
 * @param source source url for the stream
 * @param fileStream readable SWC filestream
 */
export async function swcParse(source: string, fileStream: fs.ReadStream): Promise<SimpleReconstruction> {
    const stream = byline.createStream(fileStream);

    const rows: SimpleReconstructionRow[] = [];
    let comments = "";

    return new Promise<SimpleReconstruction>((resolve) => {
        stream.on("readable", () => {
            let line: Buffer;
            while ((line = stream.read()) !== null) {
                const lineContent = line.toString("utf8");

                if (lineContent.length == 0) {
                    continue;
                }

                if (lineContent[0] === "#") {
                    comments += lineContent + "\n";
                }

                const row = parseSwcLine(lineContent);

                if (row) {
                    if (row.parentIndex === -1 && row.structure !== NodeStructures.soma) {
                        comments += `# Un-parented (root) node ${row.index} converted from ${row.structure} to soma (${NodeStructures.soma})\n`;
                        row.structure = NodeStructures.soma;
                    }

                    rows.push(row);
                }
            }
        });
        stream.on("end", () => {
            resolve(buildSimpleReconstruction(source, rows, comments));
        });
    });
}

function parseSwcLine(lineContent: string): SimpleReconstructionRow | null {
    const data = lineContent.split(/\s/);

    if (data.length != 7) {
        return null;
    }

    const index = parseInt(data[0]);
    const parentIndex = parseInt(data[6]);

    if (isNaN(index) || isNaN(parentIndex)) {
        return null;
    }

    return {
        index: index,
        parentIndex: parentIndex,
        structure: parseInt(data[1]),
        x: parseFloat(data[2]),
        y: parseFloat(data[3]),
        z: parseFloat(data[4]),
        radius: parseFloat(data[5]),
        atlasStructure: null
    };
}
