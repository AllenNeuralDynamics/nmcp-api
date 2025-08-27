import {BelongsToGetAssociationMixin} from "sequelize";

import {BaseModel} from "./baseModel";
import {AxonStructureId, DendriteStructureId, TracingStructure} from "./tracingStructure";
import {Reconstruction} from "./reconstruction";
import {jsonParse} from "../io/jsonParser";
import {swcParse} from "../io/swcParser";
import {ParsedReconstruction} from "../io/parsedReconstruction";

export interface IUploadIntermediate {
    tracing: TracingBaseModel;
    error: Error;
}

export interface ITracingDataInput {
    input: ParsedReconstruction;
    tracingStructureId: string;
}

export class TracingBaseModel extends BaseModel {
    public id: string;
    public filename: string;
    public fileComments: string;
    public nodeCount?: number;
    public pathCount?: number;
    public branchCount?: number;
    public endCount?: number;
    public reconstructionId: string;
    public tracingStructureId?: string;

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;

    public Reconstruction: Reconstruction;

    protected static async parseUploadedFile(file: any, tStructureId: string): Promise<ITracingDataInput[]>  {
        let tracingInputs: ITracingDataInput[] = [];

        if (file.filename.endsWith(".json")) {
            const [axonData, dendriteData] = await jsonParse(file.createReadStream());

            if (axonData) {
                tracingInputs.push({input: axonData, tracingStructureId: AxonStructureId});
            }

            if (dendriteData) {
                tracingInputs.push({input: dendriteData, tracingStructureId: DendriteStructureId});
            }
        } else {
            const data = await swcParse(file.createReadStream());
            tracingInputs.push({input: data, tracingStructureId: tStructureId});
        }

        return tracingInputs;
    }
}
