import {NodeStructures} from "../models/nodeStructure";

export class SearchIndexCounts {
    public node: number = 0;
    public path: number = 0;
    public branch: number = 0;
    public end: number = 0;

    public addNode(structureIdentifier: NodeStructures): void {
        this.node++;

        switch (structureIdentifier) {
            case NodeStructures.soma:
                // Skip, just contributes to total count
                break;
            case NodeStructures.forkPoint:
                this.branch++;
                break;
            case NodeStructures.endPoint:
                this.end++;
                break;
            default:
                this.path++;
        }
    }
}
