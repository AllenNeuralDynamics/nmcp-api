import {StructureIdentifiers} from "../models/structureIdentifier";

export class CompartmentStatistics {
    public Node: number = 0;
    public Soma: number = 0;
    public Path: number = 0;
    public Branch: number = 0;
    public End: number = 0;

    public addNode(structureIdentifier: StructureIdentifiers, increaseNodeCount: boolean = true): void {
        if (increaseNodeCount) {
            this.Node++;
        }

        switch (structureIdentifier) {
            case StructureIdentifiers.soma:
                this.Soma++;
                break;
            case StructureIdentifiers.forkPoint:
                this.Branch++;
                break;
            case StructureIdentifiers.endPoint:
                this.End++;
                break;
            default:
                this.Path++;
        }
    }
}
