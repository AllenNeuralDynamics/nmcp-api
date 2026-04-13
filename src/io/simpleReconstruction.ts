import {ReadStream} from "fs";
import {NeuronStructure} from "../models/neuronStructure";
import {NodeStructures} from "../models/nodeStructure";
import {swcParse} from "./swcParser";
import {PortalNode} from "./portalFormat";

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
    private _soma: PortalNode;

    private _soma_count: number;
    private _paths: number;
    private _branches: number;
    private _ends: number;

    private _comments: string;

    private readonly _neuronStructureId: string;
    private readonly _nodes: Map<number, PortalNode>;
    private readonly _nodeChildCount: Map<number, number>;

    public constructor(neuronStructureId: string) {
        this._neuronStructureId = neuronStructureId;

        this._soma_count = 0;
        this._paths = 0;
        this._branches = 0;
        this._ends = 0;

        this._comments = "";

        this._nodes = new Map<number, PortalNode>();
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

    public get soma(): PortalNode {
        return this._soma;
    }

    public getNonSomaNodes(): PortalNode[] {
        return Array.from(this._nodes.values());
    }

    public addNode(node: PortalNode): void {
        if (node.parentIndex == -1) {
            if (this._soma) {
                debug("already have a soma for this neuron structure");
            }
            this._soma = node;
        } else {
            this._nodes.set(node.index, node);
        }
    }

    public finalize(): void {
        this.countChildren();
        this.countNodeTypes();
    }

    private countChildren(): void {
        this._nodes.forEach(node => {
            if (node.parentIndex != -1) {
                if (!this._nodeChildCount.has(node.parentIndex)) {
                    this._nodeChildCount.set(node.parentIndex, 1);
                } else {
                    let count = this._nodeChildCount.get(node.parentIndex);
                    this._nodeChildCount.set(node.parentIndex, count + 1);
                }
            }
        });
    }

    private countNodeTypes() {
        const pathType = this._neuronStructureId == NeuronStructure.AxonStructureId ? NodeStructures.axon : NodeStructures.basalDendrite;

        this._nodes.forEach(s => {
            if (s.structure != NodeStructures.soma) {
                // Label anything with <> 1 child as a branch or end point.
                switch (this._nodeChildCount.get(s.index) ?? 0) {
                    case 0:
                        s.structure = NodeStructures.endPoint;
                        break;
                    case 1:
                        s.structure = pathType;
                        break;
                    default:
                        s.structure = NodeStructures.forkPoint;
                }

                if (!s.lengthToParent) {
                    // Calculate length to parent.
                    if (this._nodes.has(s.parentIndex)) {
                        const parent = this._nodes.get(s.parentIndex);

                        // Length to parent in micrometers
                        s.lengthToParent = Math.sqrt(
                            Math.pow(s.x - parent.x, 2) +
                            Math.pow(s.y - parent.y, 2) +
                            Math.pow(s.z - parent.z, 2)
                        );
                    }
                }
            }

            switch (s.structure) {
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

export async function parseSwcFile(source: string, swcFile: ReadStream): Promise<SimpleReconstruction> {
    return await swcParse(source, swcFile);
}
