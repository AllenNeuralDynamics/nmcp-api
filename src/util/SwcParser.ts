import * as byline from "byline";
import * as fs from "fs";
import {StructureIdentifiers} from "../models/structureIdentifier";

export interface ISwcSample {
    sampleNumber: number;
    parentNumber: number;
    structure: number;
    x: number
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
}

export class SwcData {
    private somas: number;
    private paths;
    private branches;
    private ends;
    private _comments: string;

    private readonly samples: Map<number, ISwcSample>;
    private readonly sampleChildCount: Map<number, number>;

    public constructor() {
        this.somas = 0;
        this.paths = 0;
        this.branches = 0;
        this.ends = 0;
        this._comments = "";

        this.samples = new Map<number, ISwcSample>();
        this.sampleChildCount = new Map<number, number>();
    }

    public get sampleCount(): number {
        return this.samples.size;
    }

    public get somaCount(): number {
        return this.somas;
    }

    public get branchCount(): number {
        return this.branches;
    }

    public get endCount(): number {
        return this.ends;
    }

    public get pathCount(): number {
        return this.paths;
    }

    public get comments(): string {
        return this._comments;
    }

    public getSamples(): ISwcSample[] {
        return Array.from(this.samples.values());
    }

    public addComment(comment: string): void {
        this._comments += comment;
    }

    public addSample(sample: ISwcSample): void {
        if (sample.parentNumber != -1) {
            let count = 0;
            if (this.sampleChildCount.has(sample.parentNumber)) {
                count = this.sampleChildCount.get(sample.parentNumber);
            }
            this.sampleChildCount.set(sample.parentNumber, ++count);
        }

        this.samples.set(sample.sampleNumber, sample);
    }

    public finalize(): void {
        this.countNodeTypes();
    }

    private countNodeTypes() {
        this.samples.forEach(s => {
            if (s.structure != StructureIdentifiers.soma) {
                // Relabel anything with <> 1 child as a branch or end point.
                if (this.sampleChildCount.has(s.sampleNumber)) {
                    if (this.sampleChildCount.get(s.sampleNumber) > 1) {
                        s.structure = StructureIdentifiers.forkPoint;
                    }
                } else {
                    s.structure = StructureIdentifiers.endPoint;
                }
                // Calculate length to parent.
                if (this.samples.has(s.parentNumber)) {
                    const parent = this.samples.get(s.parentNumber);

                    s.lengthToParent = Math.sqrt(
                        Math.pow(s.x - parent.x, 2) +
                        Math.pow(s.y - parent.y, 2) +
                        Math.pow(s.z - parent.z, 2)
                    )
                }
            }

            switch (s.structure) {
                case StructureIdentifiers.soma:
                    this.somas++;
                    break;
                case StructureIdentifiers.forkPoint:
                    this.branches++;
                    break;
                case StructureIdentifiers.endPoint:
                    this.ends++;
                    break;
                default:
                    this.paths++;
            }
        });
    }
}

/**
 * Parse a SWC file and calculate branch/end points and lengths between nodes.
 *
 * @param fileStream readable SWC filestream
 */
export async function swcParse(fileStream: fs.ReadStream): Promise<SwcData> {
    const stream = byline.createStream(fileStream);

    const swcData = new SwcData();

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

function oneSwcLine(line: string, swcData: SwcData) {
    let lineContent = line.trim();

    if (lineContent.length == 0) {
        return;
    }

    if (lineContent[0] === "#") {
        swcData.addComment(lineContent + "\n");
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
        x: parseFloat(data[2]),
        y: parseFloat(data[3]),
        z: parseFloat(data[4]),
        radius: parseFloat(data[5]),
        lengthToParent: 0
    });
}

function oneSwcFileComplete(swcData: SwcData, resolve) {
    swcData.finalize();

    resolve(swcData);
}
