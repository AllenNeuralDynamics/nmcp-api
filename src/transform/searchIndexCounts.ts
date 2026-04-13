import {NodeStructure, NodeStructures} from "../models/nodeStructure";
import {AtlasNode} from "../models/atlasNode";
import {NeuronStructure} from "../models/neuronStructure";

export class SearchIndexCounts {
    public node: number = 0;
    public path: number = 0;
    public branch: number = 0;
    public end: number = 0;
    public axonLengthMicrometers: number = 0;
    public dendriteLengthMicrometers: number = 0;

    public addNode(node: AtlasNode): void {
        this.node++;

        if (node.neuronStructureId == NeuronStructure.AxonStructureId) {
            this.axonLengthMicrometers += node.lengthToParent;
        } else if (node.neuronStructureId == NeuronStructure.DendriteStructureId) {
            this.dendriteLengthMicrometers += node.lengthToParent;
        }

        const structureIdentifier = NodeStructure.valueForId(node.nodeStructureId);

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
