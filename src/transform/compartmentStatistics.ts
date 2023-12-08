import {StructureIdentifiers} from "../models/structureIdentifier";

export interface ICompartmentStatistics {
    Node: number;
    Soma: number;
    Path: number;
    Branch: number;
    End: number;

    addNode(structureIdentifier: StructureIdentifiers): void;
}

export class CompartmentStatistics implements ICompartmentStatistics {
    public Node: number = 0;
    public Soma: number = 0;
    public Path: number = 0;
    public Branch: number = 0;
    public End: number = 0;

    public addNode(structureIdentifier: StructureIdentifiers): void {
        this.Node++;

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
