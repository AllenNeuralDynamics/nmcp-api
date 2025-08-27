import {StructureIdentifiers} from "../models/structureIdentifier";

export type ParsedNode = {
    sampleNumber: number;
    parentNumber: number;
    structure: number;
    x: number
    y: number;
    z: number;
    radius: number;
    lengthToParent: number;
    brainStructureId: string;
}

export class ParsedReconstruction {
    public offsetX: number;
    public offsetY: number;
    public offsetZ: number;

    private somas: number;
    private paths;
    private branches;
    private ends;
    private _comments: string;

    private readonly samples: Map<number, ParsedNode>;
    private readonly sampleChildCount: Map<number, number>;

    public constructor() {
        this.somas = 0;
        this.paths = 0;
        this.branches = 0;
        this.ends = 0;
        this._comments = "";

        this.samples = new Map<number, ParsedNode>();
        this.sampleChildCount = new Map<number, number>();

        this.offsetX = 0;
        this.offsetY = 0;
        this.offsetZ = 0;
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

    public getSamples(): ParsedNode[] {
        return Array.from(this.samples.values());
    }

    public addComment(comment: string): void {
        this._comments += comment;
    }

    public addSample(sample: ParsedNode): void {
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

                    // Length to parent in millimeters
                    s.lengthToParent = Math.sqrt(
                        Math.pow(s.x - parent.x, 2) +
                        Math.pow(s.y - parent.y, 2) +
                        Math.pow(s.z - parent.z, 2)
                    ) / 1000;
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
