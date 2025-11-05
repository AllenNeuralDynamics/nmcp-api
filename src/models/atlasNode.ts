import {Sequelize, DataTypes, BelongsToGetAssociationMixin} from "sequelize";

import {AtlasNodeTableName} from "./tableNames";
import {BaseModel} from "./baseModel";
import {NodeStructure} from "./nodeStructure";
import {NeuronStructure} from "./neuronStructure";
import {PortalJsonNode} from "../io/portalJson";
import {AtlasReconstruction} from "./atlasReconstruction";
import {AtlasStructure} from "./atlasStructure";
import {mapToSpecimenNodeShape, SpecimenNodeShape} from "./specimenNode";
import {Atlas} from "./atlas";

export type AtlasNodeShape = SpecimenNodeShape & {
    atlasStructureId: string;
    manualAtlasAssigment: boolean;
}

export function mapToAtlasNodeShape(node: PortalJsonNode, neuronStructureId: string, reconstructionId: string): AtlasNodeShape {
    // TODO Atlas need to be provided the correct atlas.
    const structureId =  Atlas.defaultAtlas.getFromStructureId(node.allenId)?.id

    return {
        ...mapToSpecimenNodeShape(node, neuronStructureId, reconstructionId),
        atlasStructureId: structureId,
        manualAtlasAssigment: structureId != null
    };
}

export class AtlasNode extends BaseModel {
    public index: number;
    public parentIndex: number;
    public x: number;
    public y: number;
    public z: number;
    public radius: number;
    public lengthToParent: number;
    public manualAtlasAssigment: boolean;
    public nodeStructureId: string;
    public neuronStructureId: string;
    public atlasStructureId: string;
    public reconstructionId: string;

    public getNodeStructure!: BelongsToGetAssociationMixin<NodeStructure>;
    public getNeuronStructure!: BelongsToGetAssociationMixin<NeuronStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<AtlasReconstruction>
    public getAtlasStructure!: BelongsToGetAssociationMixin<AtlasStructure>;

    public readonly NodeStructure?: NodeStructure;
    public readonly NeuronStructure?: NeuronStructure;
    public readonly AtlasStructure?: AtlasStructure
    public readonly Reconstruction?: AtlasReconstruction;
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return AtlasNode.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        index: DataTypes.INTEGER,
        parentIndex: DataTypes.INTEGER,
        x: DataTypes.DOUBLE,
        y: DataTypes.DOUBLE,
        z: DataTypes.DOUBLE,
        radius: DataTypes.DOUBLE,
        lengthToParent: DataTypes.DOUBLE,
        manualAtlasAssigment: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    }, {
        tableName: AtlasNodeTableName,
        timestamps: true,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    AtlasNode.belongsTo(NodeStructure, {foreignKey: "nodeStructureId"});
    AtlasNode.belongsTo(NeuronStructure, {foreignKey: "neuronStructureId"});
    AtlasNode.belongsTo(AtlasStructure, {foreignKey: "atlasStructureId"});
    AtlasNode.belongsTo(AtlasReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
