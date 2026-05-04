import {Sequelize, DataTypes, BelongsToGetAssociationMixin, FindOptions} from "sequelize";

import {Neuron} from "./neuron";
import {BaseModel} from "./baseModel";
import {NeuronStructure} from "./neuronStructure";
import {AtlasStructure} from "./atlasStructure";
import {SearchIndexTableName} from "./tableNames";
import {AtlasReconstruction} from "./atlasReconstruction";
import {Atlas} from "./atlas";
import {AtlasKind} from "./atlasKind";
import {Collection} from "./collection";
import {SearchContext} from "./searchContext";
import {PredicateComposition} from "./queryPredicate";
import * as _ from "lodash";

export type SearchIndexShape = {
    somaX: number;
    somaY: number;
    somaZ: number;
    nodeCount: number;
    pathCount: number;
    branchCount: number;
    endCount: number;
    neuronLabel: string;
    doi: string;
    canonicalDoi: string;
    specimenLabel: string;
    totalLengthMicrometer: number;
    axonLengthMicrometer: number;
    dendriteLengthMicrometer: number;
    atlasKindId: string;
    atlasId: string;
    collectionId: string;
    neuronId: string;
    reconstructionId: string;
    neuronStructureId: string;
    atlasStructureId: string;
}

export interface PredicateResult {
    durationMs: number;
    rawNeuronIds: string[];
    composedNeuronIds: string[];
}

export interface FilterQueryResult {
    neuronIds: string[];
    predicateResults: PredicateResult[];
}

export class SearchIndex extends BaseModel {
    public somaX: number;
    public somaY: number;
    public somaZ: number;
    public nodeCount: number;
    public pathCount: number;
    public branchCount: number;
    public endCount: number;
    public neuronLabel: string;
    public doi: string;
    public canonicalDoi: string;
    public specimenLabel: string;
    public totalLengthMicrometer: number;
    public axonLengthMicrometer: number;
    public dendriteLengthMicrometer: number;
    public atlasKindId: string;
    public atlasId: string;
    public collectionId: string;
    public neuronId: string;
    public reconstructionId: string;
    public neuronStructureId: string;
    public atlasStructureId: string;

    public AtlasStructure?: AtlasStructure;
    public Neuron?: Neuron;
    public NeuronStructure?: NeuronStructure;
    public Reconstruction?: AtlasReconstruction;

    public getAtlasStructure!: BelongsToGetAssociationMixin<AtlasStructure>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getNeuronStructure!: BelongsToGetAssociationMixin<NeuronStructure>;
    public getReconstruction!: BelongsToGetAssociationMixin<AtlasReconstruction>;

    public static async performNeuronsFilterQuery(context: SearchContext): Promise<FilterQueryResult> {
        const findOptions: FindOptions[] = context.Predicates.map((predicate) => predicate.createFindOptions(context.CollectionIds));

        const predicateResults: PredicateResult[] = [];
        let composedNeuronIds: string[] = [];

        for (let predicateIdx = 0; predicateIdx < findOptions.length; predicateIdx++) {
            const option = findOptions[predicateIdx];
            option.attributes = ["id", "neuronId"];

            const start = Date.now();
            const indices = await SearchIndex.findAll(option);
            const durationMs = Date.now() - start;

            const rawNeuronIds = _.uniq(indices.map(idx => idx.neuronId));

            if (predicateIdx === 0 || context.Predicates[predicateIdx].composition === PredicateComposition.or) {
                composedNeuronIds = _.union(composedNeuronIds, rawNeuronIds);
            } else if (context.Predicates[predicateIdx].composition === PredicateComposition.and) {
                composedNeuronIds = _.intersection(composedNeuronIds, rawNeuronIds);
            } else {
                composedNeuronIds = _.difference(composedNeuronIds, rawNeuronIds);
            }

            predicateResults.push({
                durationMs,
                rawNeuronIds,
                composedNeuronIds: [...composedNeuronIds],
            });
        }

        return {neuronIds: composedNeuronIds, predicateResults};
    }
}

const SearchIndexModelAttributes = {
    id: {
        primaryKey: true,
        type: DataTypes.UUID,
        defaultValue: Sequelize.literal("uuidv7()")
    },
    somaX: {
        type: DataTypes.DOUBLE,
        defaultValue: 0.0
    },
    somaY: {
        type: DataTypes.DOUBLE,
        defaultValue: 0.0
    },
    somaZ: {
        type: DataTypes.DOUBLE,
        defaultValue: 0.0
    },
    nodeCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    pathCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    branchCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    endCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    neuronLabel: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    doi: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    canonicalDoi: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    specimenLabel: {
        type: DataTypes.TEXT,
        defaultValue: ""
    },
    totalLengthMicrometer: {
        type: DataTypes.DOUBLE,
        defaultValue: 0.0
    },
    axonLengthMicrometer: {
        type: DataTypes.DOUBLE,
        defaultValue: 0.0
    },
    dendriteLengthMicrometer: {
        type: DataTypes.DOUBLE,
        defaultValue: 0.0
    }
};

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return SearchIndex.init(SearchIndexModelAttributes, {
        tableName: SearchIndexTableName,
        timestamps: true,
        deletedAt: false,
        paranoid: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    SearchIndex.belongsTo(Atlas, {foreignKey: "atlasId"})
    SearchIndex.belongsTo(AtlasKind, {foreignKey: "atlasKindId"})
    SearchIndex.belongsTo(Neuron, {foreignKey: "neuronId"});
    SearchIndex.belongsTo(Collection, {foreignKey: "collectionId"});
    SearchIndex.belongsTo(NeuronStructure, {foreignKey: "neuronStructureId"});
    SearchIndex.belongsTo(AtlasReconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
    SearchIndex.belongsTo(NeuronStructure, {foreignKey: "neuronStructureId"});
    SearchIndex.belongsTo(AtlasStructure, {foreignKey: "atlasStructureId"});
};
