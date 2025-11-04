import {AxonStructureId, DendriteStructureId} from "../models/tracingStructure";
import {StructureIdentifiers} from "../models/structureIdentifier";
import {jsonParse} from "./jsonParser";
import {swcParse} from "./swcParser";

export type SimpleNode = {
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

export class SimpleNeuronStructure {
    private readonly _neuronStructureId: string;

    public offsetX: number;
    public offsetY: number;
    public offsetZ: number;

    private somas: number;
    private paths;
    private branches;
    private ends;
    private _comments: string;

    private readonly nodes: Map<number, SimpleNode>;
    private readonly nodeChildCount: Map<number, number>;

    public constructor(neuronStructureId: string) {
        this._neuronStructureId = neuronStructureId;

        this.somas = 0;
        this.paths = 0;
        this.branches = 0;
        this.ends = 0;
        this._comments = "";

        this.nodes = new Map<number, SimpleNode>();
        this.nodeChildCount = new Map<number, number>();

        this.offsetX = 0;
        this.offsetY = 0;
        this.offsetZ = 0;
    }

    public get NeuronStructureId(): string {
        return this._neuronStructureId;
    }

    public get nodeCount(): number {
        return this.nodes.size;
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

    public getNodes(): SimpleNode[] {
        return Array.from(this.nodes.values());
    }

    public addComment(comment: string): void {
        this._comments += comment;
    }

    public addSample(sample: SimpleNode): void {
        if (sample.parentNumber != -1) {
            let count = 0;
            if (this.nodeChildCount.has(sample.parentNumber)) {
                count = this.nodeChildCount.get(sample.parentNumber);
            }
            this.nodeChildCount.set(sample.parentNumber, ++count);
        }

        this.nodes.set(sample.sampleNumber, sample);
    }

    public finalize(): void {
        this.countNodeTypes();
    }

    private countNodeTypes() {
        this.nodes.forEach(s => {
            if (s.structure != StructureIdentifiers.soma) {
                // Relabel anything with <> 1 child as a branch or end point.
                if (this.nodeChildCount.has(s.sampleNumber)) {
                    if (this.nodeChildCount.get(s.sampleNumber) > 1) {
                        s.structure = StructureIdentifiers.forkPoint;
                    }
                } else {
                    s.structure = StructureIdentifiers.endPoint;
                }
                // Calculate length to parent.
                if (this.nodes.has(s.parentNumber)) {
                    const parent = this.nodes.get(s.parentNumber);

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

export type ParsedReconstruction = {
    source: string;
    comments: string;
    axon: SimpleNeuronStructure
    dendrite: SimpleNeuronStructure;
}

export async function parseSwcFile(file: any, structureId: string): Promise<SimpleNeuronStructure> {
    return await swcParse(structureId, file.createReadStream());
}

export async function parseJsonFile(file: any): Promise<ParsedReconstruction> {

    const [axonData, dendriteData] = await jsonParse(file.createReadStream());

    return {
        source: file.filename,
        comments: axonData.comments,
        axon: axonData,
        dendrite: dendriteData
    };
}

export async function parseSwcFiles(axonFile: any, dendriteFile: any): Promise<ParsedReconstruction> {
    const [axonData, dendriteData] = await Promise.all([
        parseSwcFile(axonFile, AxonStructureId),
        parseSwcFile(dendriteFile, DendriteStructureId)
    ]);

    return {
        source: `${axonFile.filename};${dendriteFile.filename}`,
        comments: [axonData.comments, dendriteData.comments].filter(s => s).join("\n"),
        axon: axonData,
        dendrite: dendriteData
    };
}
