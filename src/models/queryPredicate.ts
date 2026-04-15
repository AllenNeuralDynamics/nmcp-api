import {FindOptions, Op} from "sequelize";

import {GreaterThanOperatorId, operatorIdValueMap} from "./queryOperator";
import {NodeStructure} from "./nodeStructure";
import {Atlas} from "./atlas";

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

type AnatomicalPredicateShape = {

}

type CustomRegionPredicateShape = {

}

type IdOrDoiPredicateShape = {

}

export type PredicateShape = {
    predicateType: PredicateType;
    composition: PredicateComposition;
    labelsOrDois: string[];
    labelOrDoiExactMatch: boolean;
    neuronStructureIds: string[];
    nodeStructureIds: string[];
    operatorId: string;
    amount: number;
    atlasStructureIds: string[];
    arbCenter: CenterPoint;
    arbSize: number;
}

export class QueryPredicate implements PredicateShape {
    predicateType: PredicateType;
    labelsOrDois: string[];
    labelOrDoiExactMatch: boolean;
    neuronStructureIds: string[];
    nodeStructureIds: string[];
    operatorId: string;
    amount: number;
    atlasStructureIds: string[];
    arbCenter: CenterPoint;
    arbSize: number;
    composition: PredicateComposition;

    public static createDefault() : QueryPredicate {
        return new QueryPredicate({
            predicateType: PredicateType.AnatomicalRegion,
            labelsOrDois: [],
            labelOrDoiExactMatch: false,
            neuronStructureIds: [],
            nodeStructureIds: [],
            operatorId: GreaterThanOperatorId,
            amount: 0,
            atlasStructureIds: [],
            arbCenter: {
                x: 0,
                y: 0,
                z: 0
            },
            arbSize: 0,
            composition: PredicateComposition.or
        })
    }

    public constructor(source: PredicateShape = null) {
        if (source === null) {
            return;
        }

        this.predicateType = source.predicateType;
        this.composition = source.composition;
        this.atlasStructureIds = source.atlasStructureIds;
        this.labelsOrDois = source.labelsOrDois;
        this.labelOrDoiExactMatch = source.labelOrDoiExactMatch;
        this.arbCenter = source.arbCenter;
        this.arbSize = source.arbSize;
        this.neuronStructureIds = source.neuronStructureIds;
        this.nodeStructureIds = source.nodeStructureIds;
        this.operatorId = source.operatorId;
        this.amount = source.amount;
    }

    public createFindOptions(collectionIds: string[]) : FindOptions {
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

                // Zero means any, two is explicitly both types - either way, do not need to filter on structure id
                if (this.neuronStructureIds?.length === 1) {
                    findOptions.where["neuronStructureId"] = this.neuronStructureIds[0];
                }

                // TODO Atlas which atlas should not be hard-coded.
                const wholeBrainId = Atlas.defaultAtlas.wholeBrainId();

                // Asking for "Whole Brain" should not eliminate nodes (particularly soma) that are outside the ontology
                // atlas.  It should be interpreted as an "all" request.  This also helps performance in that there isn't
                // a where statement with every structure id.
                const applicableCompartments = this.atlasStructureIds?.filter(id => id != wholeBrainId);

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

                if (this.labelOrDoiExactMatch || this.labelsOrDois.length === 0) {
                    where = {
                        [Op.or]: [
                            {
                                neuronLabel: {
                                    [Op.in]: this.labelsOrDois
                                }
                            },
                            {
                                doi: {
                                    [Op.in]: this.labelsOrDois
                                }
                            },
                            {
                                specimenLabel: {
                                    [Op.in]: this.labelsOrDois
                                }
                            }
                        ]
                    };
                } else {
                    if (this.labelsOrDois.length === 1) {
                        where = {
                            [Op.or]: [
                                {
                                    neuronLabel: {
                                        [Op.iLike]: `%${this.labelsOrDois[0]}%`
                                    }
                                },
                                {
                                    doi: {
                                        [Op.iLike]: `%${this.labelsOrDois[0]}%`
                                    }
                                },
                                {
                                    specimenLabel: {
                                        [Op.iLike]: `%${this.labelsOrDois[0]}%`
                                    }
                                }
                            ]
                        };
                    } else {
                        const ors = this.labelsOrDois.map(id => {
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

        if (this.predicateType !== PredicateType.IdOrDoi) {
            let opCode = null;
            let amount = 0;

            if (this.operatorId && this.operatorId.length > 0) {
                const operator = operatorIdValueMap().get(this.operatorId);
                if (operator) {
                    opCode = operator.operatorSymbol;
                }
                amount = this.amount;
                debug(`found operator ${operator} with opCode ${operator.operator2} for amount ${amount}`);
            } else {
                opCode = Op.gt;
                amount = 0;
                debug(`operator is null, using opCode $gt for amount ${amount}`);
            }

            if (opCode) {
                if (this.nodeStructureIds?.length > 1) {
                    let subQ = this.nodeStructureIds.map(s => {
                        const columnName = NodeStructure.countColumnName(s);

                        if (columnName) {
                            let obj = {};

                            obj[columnName] = createOperator(opCode, amount);

                            return obj;
                        }

                        debug(`failed to identify column name for count of structure id ${s}`);

                        return null;
                    }).filter(q => q !== null);

                    if (subQ.length > 0) {
                        findOptions.where[Op.or] = subQ;
                    }
                } else if (this.nodeStructureIds?.length > 0) {
                    const columnName = NodeStructure.countColumnName(this.nodeStructureIds[0]);

                    if (columnName) {
                        findOptions.where[columnName] = createOperator(opCode, amount);
                    } else {
                        debug(`failed to identify column name for count of structure id ${this.nodeStructureIds[0]}`);
                    }
                } else {
                    findOptions.where["nodeCount"] = createOperator(opCode, amount);
                }
            } else {
                // TODO return error
                debug("failed to find operator");
            }
        }

        return findOptions;
    }
}

function createOperator(operator: symbol, amount: number) {
    const obj = {};

    obj[operator] = amount;

    return obj;
}
