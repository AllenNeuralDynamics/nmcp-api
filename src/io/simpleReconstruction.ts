import {ReadStream} from "fs";
import {jsonChunkParse} from "./jsonParser";
import {NeuronStructure} from "../models/neuronStructure";
import {NodeStructures} from "../models/nodeStructure";
import {swcParse} from "./swcParser";
import {PortalJsonNode} from "./portalJson";

const debug = require("debug")("nmcp:nmcp-api:simple-reconstruction");

export type NodeCount = {
    total: number;
    soma: number;
    path: number;
    branch: number;
    end: number;
}
export type NodeCounts = {
    axon: NodeCount;
    dendrite: NodeCount;
}

export class SimpleNeuronStructure {
    private _soma: PortalJsonNode;

    private _soma_count: number;
    private _paths: number;
    private _branches: number;
    private _ends: number;

    private _comments: string;

    private readonly _neuronStructureId: string;
    private readonly _nodes: Map<number, PortalJsonNode>;
    private readonly _nodeChildCount: Map<number, number>;

    public constructor(neuronStructureId: string) {
        this._neuronStructureId = neuronStructureId;

        this._soma_count = 0;
        this._paths = 0;
        this._branches = 0;
        this._ends = 0;

        this._comments = "";

        this._nodes = new Map<number, PortalJsonNode>();
        this._nodeChildCount = new Map<number, number>();
    }

    public get NeuronStructureId(): string {
        return this._neuronStructureId;
    }

    public get nodeCounts(): NodeCount {
        return {
            total: this._nodes.size,
            soma: this._soma_count,
            path: this._paths,
            branch: this._branches,
            end: this._ends
        };
    }

    public get nodeCount(): number {
        return this._nodes.size;
    }

    public get branchCount(): number {
        return this._branches;
    }

    public get endCount(): number {
        return this._ends;
    }

    public get pathCount(): number {
        return this._paths;
    }

    public get comments(): string {
        return this._comments;
    }

    public get soma(): PortalJsonNode {
        return this._soma;
    }

    public getNonSomaNodes(): PortalJsonNode[] {
        return Array.from(this._nodes.values());
    }

    public addComment(comment: string): void {
        this._comments += comment;
    }

    public addNode(node: PortalJsonNode): void {
        if (node.parentNumber == -1) {
            if (this._soma) {
                debug("already have soma for this neuron structure");
            }
            this._soma = node;
        } else {
            this._nodes.set(node.sampleNumber, node);
        }
    }

    public finalize(): void {
        const nodes = Array.from(this._nodes.values()).filter(n => n.parentNumber != -1).sort((a, b) => a.sampleNumber - b.sampleNumber);

        if (nodes.length > 0) {
            const offset = nodes[0].sampleNumber - 2;

            if (offset > 0) {
                nodes.forEach((node: PortalJsonNode) => {
                    node.sampleNumber -= offset;
                    if (node.parentNumber != 1) {
                        node.parentNumber -= offset;
                    }
                });
            }
        }

        this.mapChildren();
        this.countNodeTypes();
    }

    private mapChildren(): void {
        this._nodes.forEach(node => {
            if (node.parentNumber != -1) {
                if (!this._nodeChildCount.has(node.parentNumber)) {
                    this._nodeChildCount.set(node.parentNumber, 1);
                } else {
                    let count = this._nodeChildCount.get(node.parentNumber);
                    this._nodeChildCount.set(node.parentNumber, count + 1);
                }
            }
        });
    }

    private countNodeTypes() {
        const pathType = this._neuronStructureId == NeuronStructure.AxonStructureId ? NodeStructures.axon : NodeStructures.basalDendrite;

        this._nodes.forEach(s => {
            if (s.structureIdentifier != NodeStructures.soma) {
                // Label anything with <> 1 child as a branch or end point.
                switch (this._nodeChildCount.get(s.sampleNumber) ?? 0) {
                    case 0:
                        s.structureIdentifier = NodeStructures.endPoint;
                        break;
                    case 1:
                        s.structureIdentifier = pathType;
                        break;
                    default:
                        s.structureIdentifier = NodeStructures.forkPoint;
                }

                if (!s.lengthToParent) {
                    // Calculate length to parent.
                    if (this._nodes.has(s.parentNumber)) {
                        const parent = this._nodes.get(s.parentNumber);

                        // Length to parent in millimeters
                        s.lengthToParent = Math.sqrt(
                            Math.pow(s.x - parent.x, 2) +
                            Math.pow(s.y - parent.y, 2) +
                            Math.pow(s.z - parent.z, 2)
                        ) / 1000;
                    }
                }
            }

            switch (s.structureIdentifier) {
                case NodeStructures.soma:
                    this._soma_count++;
                    break;
                case NodeStructures.forkPoint:
                    this._branches++;
                    break;
                case NodeStructures.endPoint:
                    this._ends++;
                    break;
                case NodeStructures.axon:
                case NodeStructures.basalDendrite:
                    this._paths++;
                    break;
                default:
                    this._paths++;
            }
        });
    }
}

export type SimpleReconstruction = {
    source: string;
    comments: string;
    axon: SimpleNeuronStructure
    dendrite: SimpleNeuronStructure;
}

export async function parseJsonFile(source: string, stream: ReadStream): Promise<SimpleReconstruction> {
    const [axonData, dendriteData] = await jsonChunkParse(stream);

    return {
        source: source,
        comments: axonData.comments,
        axon: axonData,
        dendrite: dendriteData
    };
}

export async function parseSwcFile(source: string, swcFile: ReadStream): Promise<SimpleReconstruction> {
    return await swcParse(source, swcFile);
}
