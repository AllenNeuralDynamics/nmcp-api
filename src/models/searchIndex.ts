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
import {FilterComposition, PredicateType} from "./queryPredicate";
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

    public static async performNeuronsFilterQuery(context: SearchContext): Promise<string[]> {
        const somaProperties = ["somaX", "somaY", "somaZ"];

        // FindOptions per-predicate.
        const findOptions: FindOptions[] = context.Predicates.map((predicate) => predicate.createFindOptions(context.CollectionIds));

        const indicesPerPredicate: (SearchIndex[])[] = [];

        const needSomas = context.Predicates.some(p => p.predicateType === PredicateType.CustomRegion && p.arbCenter && p.arbSize);

        const attributes = needSomas ? ["id", "neuronId", ...somaProperties] : ["id", "neuronId"];

        for (const option of findOptions) {
            option.attributes = attributes;
            indicesPerPredicate.push(await SearchIndex.findAll(option));
        }

        // Not interested in individual compartment results.  Just want unique neurons for per-predicate.
        const neuronIdsPerPredicate: string[][] = indicesPerPredicate.map((indexList, index) => {
            // Additional filter for custom region.  May be able to do in database (?).
            const predicate = context.Predicates[index];

            if (predicate.predicateType === PredicateType.CustomRegion && predicate.arbCenter && predicate.arbSize) {
                const pos = predicate.arbCenter;

                indexList = indexList.filter((searchIndex) => {
                    const distance = Math.sqrt(Math.pow(pos.x - searchIndex.somaX, 2) + Math.pow(pos.y - searchIndex.somaY, 2) + Math.pow(pos.z - searchIndex.somaZ, 2));

                    return distance <= predicate.arbSize;
                });
            }

            return _.uniq(indexList.map(c => c.neuronId));
        });

        const neuronIds = neuronIdsPerPredicate.length == 1 ? neuronIdsPerPredicate[0] : neuronIdsPerPredicate.reduce((prev, curr, index) => {
            if (index === 0 || context.Predicates[index].composition === FilterComposition.or) {
                return _.union(prev, curr);
            } else if (context.Predicates[index].composition === FilterComposition.and) {
                return _.intersection(prev, curr);
            } else {
                // Not
                return _.difference(prev, curr);
            }
        }, []);

        return neuronIds;
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
