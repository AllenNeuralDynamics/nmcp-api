import {FindOptions, Op} from "sequelize";

import {GreaterThanOperatorId, operatorIdValueMap} from "./queryOperator";
import {NodeStructure} from "./nodeStructure";
import {Atlas} from "./atlas";
import {NeuronStructure} from "./neuronStructure";

const debug = require("debug")("mnb:search-api:query-predicate");

export enum PredicateType {
    AnatomicalRegion = 1,
    CustomRegion = 2,
    IdOrDoi = 3
}

export enum PredicateComposition {
    and = 1,
    or = 2,
    not = 3
}

type CenterPoint = {
    x: number;
    y: number;
    z: number;
}

export type AnatomicalPredicateShape = {
    neuronStructureId: string;
    nodeStructureId: string;
    operatorId: string;
    amount: number;
    atlasStructureIds: string[];
}

export type CustomRegionPredicateShape = {
    arbCenter: CenterPoint;
    arbSize: number;
}

export type IdOrDoiPredicateShape = {
    labelsOrDois: string[];
    labelOrDoiExactMatch: boolean;
}

export type PredicateShape = {
    predicateType: PredicateType;
    composition: PredicateComposition
    anatomicalPredicate?: AnatomicalPredicateShape;
    customRegionPredicate?: CustomRegionPredicateShape;
    idOrDoiPredicate?: IdOrDoiPredicateShape;
}

export class QueryPredicate implements PredicateShape {
    predicateType: PredicateType;
    composition: PredicateComposition;
    anatomicalPredicate?: AnatomicalPredicateShape;
    customRegionPredicate?: CustomRegionPredicateShape;
    idOrDoiPredicate?: IdOrDoiPredicateShape;

    public static createDefault(): QueryPredicate {
        return new QueryPredicate({
            predicateType: PredicateType.AnatomicalRegion,
            composition: PredicateComposition.or,
            anatomicalPredicate: {
                neuronStructureId: "",
                nodeStructureId: "",
                operatorId: GreaterThanOperatorId,
                amount: 0,
                atlasStructureIds: [],
            },
        });
    }

    public constructor(source: PredicateShape = null) {
        if (source === null) {
            return;
        }

        this.predicateType = source.predicateType;
        this.composition = source.composition;
        this.anatomicalPredicate = source.anatomicalPredicate;
        this.customRegionPredicate = source.customRegionPredicate;
        this.idOrDoiPredicate = source.idOrDoiPredicate;
    }

    public createFindOptions(collectionIds: string[]): FindOptions {
        const findOptions: FindOptions = {};

        function applyCollectionFilter(options: FindOptions) {
            if (collectionIds && collectionIds.length > 0) {
                if (collectionIds.length == 1) {
                    options.where["collectionId"] = collectionIds[0];
                } else {
                    options.where["collectionId"] = {[Op.in]: collectionIds};
                }
            }
        }

        switch (this.predicateType) {
            case PredicateType.AnatomicalRegion:
                findOptions.where = {};

                applyCollectionFilter(findOptions);

                // TODO Atlas which atlas should not be hard-coded.
                const wholeBrainId = Atlas.defaultAtlas.wholeBrainId();

                // Asking for "Whole Brain" should not eliminate nodes (particularly soma) that are outside the ontology
                // atlas.  It should be interpreted as an "all" request.  This also helps performance in that there isn't
                // a where statement with every structure id.
                const applicableCompartments = this.anatomicalPredicate?.atlasStructureIds?.filter(id => id != wholeBrainId);

                if (applicableCompartments?.length > 0) {
                    // Find all brain areas that are these or children of in terms of structure path.
                    // TODO Atlas which atlas should not be hard-coded.
                    const comprehensiveBrainAreas = applicableCompartments.map(id => Atlas.defaultAtlas.getComprehensiveBrainArea(id)).reduce((prev, curr) => {
                        return prev.concat(curr);
                    }, []);

                    findOptions.where["atlasStructureId"] = {
                        [Op.in]: comprehensiveBrainAreas
                    };
                }
                break;
            case PredicateType.CustomRegion:
                findOptions.where = {};

                applyCollectionFilter(findOptions);
                break;
            case PredicateType.IdOrDoi:
                let where = null;

                const labelsOrDois = this.idOrDoiPredicate?.labelsOrDois ?? [];
                const exactMatch = this.idOrDoiPredicate?.labelOrDoiExactMatch;

                if (exactMatch || labelsOrDois.length === 0) {
                    where = {
                        [Op.or]: [
                            {
                                neuronLabel: {
                                    [Op.in]: labelsOrDois
                                }
                            },
                            {
                                doi: {
                                    [Op.in]: labelsOrDois
                                }
                            },
                            {
                                specimenLabel: {
                                    [Op.in]: labelsOrDois
                                }
                            }
                        ]
                    };
                } else {
                    if (labelsOrDois.length === 1) {
                        where = {
                            [Op.or]: [
                                {
                                    neuronLabel: {
                                        [Op.iLike]: `%${labelsOrDois[0]}%`
                                    }
                                },
                                {
                                    doi: {
                                        [Op.iLike]: `%${labelsOrDois[0]}%`
                                    }
                                },
                                {
                                    specimenLabel: {
                                        [Op.iLike]: `%${labelsOrDois[0]}%`
                                    }
                                }
                            ]
                        };
                    } else {
                        const ors = labelsOrDois.map(id => {
                            return {
                                [Op.or]: [
                                    {
                                        neuronLabel: {
                                            [Op.iLike]: `%${id}%`
                                        }
                                    },
                                    {
                                        doi: {
                                            [Op.iLike]: `%${id}%`
                                        }
                                    },
                                    {
                                        specimenLabel: {
                                            [Op.iLike]: `%${id}%`
                                        }
                                    }
                                ]
                            }
                        });

                        where = {
                            [Op.or]: ors
                        }
                    }
                }

                findOptions.where = where;

                applyCollectionFilter(findOptions);

                break;
        }

        if (this.predicateType == PredicateType.AnatomicalRegion && this.anatomicalPredicate) {
            debug(this);
            let opCode = null;
            let amount = 0;

            const operatorId = this.anatomicalPredicate.operatorId;

            if (operatorId && operatorId.length > 0) {
                const operator = operatorIdValueMap().get(operatorId);
                if (operator) {
                    opCode = operator.operatorSymbol;
                }
                amount = this.anatomicalPredicate?.amount ?? 0;
                debug(`found operator ${operator} with opCode ${operator.operator2} for amount ${amount}`);
            } else {
                opCode = Op.gt;
                amount = 0;
                debug(`operator is null, using opCode $gt for amount ${amount}`);
            }

            if (opCode) {
                const neuronStructureId = this.anatomicalPredicate.neuronStructureId;
                const nodeStructureId = this.anatomicalPredicate.nodeStructureId;

                if (neuronStructureId?.length > 0) {
                    if (nodeStructureId?.length > 0) {
                        // Neuron + node structure is a node count such as axon branch point.
                        findOptions.where["neuronStructureId"] = this.anatomicalPredicate.neuronStructureId;

                        const columnName = NodeStructure.countColumnName(nodeStructureId);

                        if (columnName) {
                            findOptions.where[columnName] = createOperator(opCode, amount);
                        } else {
                            debug(`failed to identify column name for count of structure id ${nodeStructureId}`);
                        }
                    } else {
                        // Neuron structure alone (other than soma) indicates length which has its own column.
                        if (neuronStructureId == NeuronStructure.AxonStructureId) {
                            findOptions.where["axonLengthMicrometer"] = createOperator(opCode, amount);
                        } else if (neuronStructureId == NeuronStructure.DendriteStructureId) {
                            findOptions.where["dendriteLengthMicrometer"] = createOperator(opCode, amount);
                        } else {
                            // Soma
                            findOptions.where["neuronStructureId"] = this.anatomicalPredicate.neuronStructureId;
                        }
                    }
                } else {
                    // Currently, any option other than "any" (total node count in compartment) will have neuronStructureId set.
                    findOptions.where["nodeCount"] = createOperator(opCode, amount);
                }
            } else {
                // TODO return error
                debug("failed to find operator");
            }
        }

        debug(findOptions);

        return findOptions;
    }
}

function createOperator(operator: symbol, amount: number) {
    const obj = {};

    obj[operator] = amount;

    return obj;
}
