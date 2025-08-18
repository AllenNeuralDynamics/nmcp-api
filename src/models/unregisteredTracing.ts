import {BelongsToGetAssociationMixin, DataTypes, HasManyGetAssociationsMixin, Op, Sequelize} from "sequelize";

import {BaseModel} from "./baseModel";
import {TracingStructure} from "./tracingStructure";
import {TracingNode} from "./tracingNode";
import {IUploadOutput} from "../graphql/secureResolvers";

import {Reconstruction} from "./reconstruction";

const debug = require("debug")("mnb:nmcp-api:unregistered-tracing");

export class UnregisteredTracing extends BaseModel {
    public id: string;
    public filename: string;
    public fileComments: string;
    public nodeCount?: number;
    public pathCount?: number;
    public branchCount?: number;
    public endCount?: number;
    public somaNodeId: string;
    public reconstructionId: string;
    public tracingStructureId?: string;

    public getTracingStructure!: BelongsToGetAssociationMixin<TracingStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;
    public getNodes!: HasManyGetAssociationsMixin<TracingNode>;

    public Nodes?: TracingNode[];
    public Reconstruction: Reconstruction;

    public static async createFromUpload(reconstructionId: string, tStructureId: string, uploadFile: Promise<any>): Promise<IUploadOutput> {
        return {tracings: null, error: {name: "NotImplementedError", message: "Unregistered tracing upload not implemented"}};
    }

}

export const modelInit = (sequelize: Sequelize) => {
    UnregisteredTracing.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        filename: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        // comment lines found in SWC file
        fileComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        nodeCount: DataTypes.INTEGER,
        pathCount: DataTypes.INTEGER,
        branchCount: DataTypes.INTEGER,
        endCount: DataTypes.INTEGER
    }, {
        tableName: "UnregisteredTracing",
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

export const modelAssociate = () => {
    UnregisteredTracing.hasMany(TracingNode, {foreignKey: "tracingId", as: "Nodes"});
    UnregisteredTracing.belongsTo(TracingStructure, {foreignKey: "tracingStructureId"});
    UnregisteredTracing.belongsTo(Reconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
