import {FindOptions, Op} from "sequelize";

import {AtlasStructure} from "./atlasStructure";
import {operatorIdValueMap} from "./queryOperator";
import {StructureIdentifier} from "./structureIdentifier";

const debug = require("debug")("mnb:search-api:query-predicate");

export enum PredicateType {
    AnatomicalRegion = 1,
    CustomRegion = 2,
    IdOrDoi = 3
}

export enum SomaOriginType {
    Automatic,
    Manual,
    Any
}

export interface ICenterPoint {
    x: number;
    y: number;
    z: number;
}

export interface IPredicateAttributes {
    predicateType: PredicateType;
    tracingIdsOrDOIs: string[];
    tracingIdsOrDOIsExactMatch: boolean;
    tracingStructureIds: string[];
    nodeStructureIds: string[];
    somaOrigin?: SomaOriginType;
    operatorId: string;
    amount: number;
    brainAreaIds: string[];
    arbCenter: ICenterPoint;
    arbSize: number;
    invert: boolean;
    composition: number;
}

export interface IQueryPredicate extends IPredicateAttributes {
    createFindOptions() : FindOptions;
}

export class QueryPredicate implements IQueryPredicate {
    predicateType: PredicateType;
    tracingIdsOrDOIs: string[];
    tracingIdsOrDOIsExactMatch: boolean;
    tracingStructureIds: string[];
    nodeStructureIds: string[];
    somaOrigin: SomaOriginType;
    operatorId: string;
    amount: number;
    brainAreaIds: string[];
    arbCenter: ICenterPoint;
    arbSize: number;
    invert: boolean;
    composition: number;

    public static createDefault() : QueryPredicate {
        return new QueryPredicate({
            predicateType: PredicateType.AnatomicalRegion,
            tracingIdsOrDOIs: [],
            tracingIdsOrDOIsExactMatch: false,
            tracingStructureIds: [],
            nodeStructureIds: [],
            somaOrigin: SomaOriginType.Automatic,
            operatorId: "8905baf3-89bc-4e23-b542-e8d0947991f8",
            amount: 0,
            brainAreaIds: [],
            arbCenter: {
                x: 0,
                y: 0,
                z: 0
            },
            arbSize: 0,
            invert: false,
            composition: 0
        })
    }

    public constructor(source: IPredicateAttributes = null) {
        if (source === null) {
            return;
        }

        this.predicateType = source.predicateType;
        this.composition = source.composition;
        this.invert = source.invert;
        this.brainAreaIds = source.brainAreaIds;
        this.tracingIdsOrDOIs = source.tracingIdsOrDOIs;
        this.tracingIdsOrDOIsExactMatch = source.tracingIdsOrDOIsExactMatch;
        this.arbCenter = source.arbCenter;
        this.arbSize = source.arbSize;
        this.tracingStructureIds = source.tracingStructureIds;
        this.nodeStructureIds = source.nodeStructureIds;
        this.somaOrigin = source.somaOrigin ?? SomaOriginType.Automatic;
        this.operatorId = source.operatorId;
        this.amount = source.amount;
    }

    public createFindOptions() : FindOptions {
        const findOptions: FindOptions = {};

        switch (this.predicateType) {
            case PredicateType.AnatomicalRegion:
                findOptions.where = {};

                // Zero means any, two is explicitly both types - either way, do not need to filter on structure id
                if (this.tracingStructureIds?.length === 1) {
                    findOptions.where["tracingStructureId"] = this.tracingStructureIds[0];
                }

                const wholeBrainId = AtlasStructure.wholeBrainId();

                // Asking for "Whole Brain" should not eliminate nodes (particularly soma) that are outside the ontology
                // atlas.  It should be interpreted as an "all" request.  This also helps performance in that there isn't
                // a where statement with every structure id.
                const applicableCompartments = this.brainAreaIds?.filter(id => id != wholeBrainId);

                if (applicableCompartments?.length > 0) {
                    // Find all brain areas that are these or children of in terms of structure path.
                    const comprehensiveBrainAreas = applicableCompartments.map(id => AtlasStructure.getComprehensiveBrainArea(id)).reduce((prev, curr) => {
                        return prev.concat(curr);
                    }, []);

                    findOptions.where["brainAreaId"] = {
                        [Op.in]: comprehensiveBrainAreas
                    };
                }
                break;
            case PredicateType.CustomRegion:
                findOptions.where = {};
                break;
            case PredicateType.IdOrDoi:
                let where = null;

                if (this.tracingIdsOrDOIsExactMatch || this.tracingIdsOrDOIs.length === 0) {
                    where = {
                        [Op.or]: [
                            {
                                neuronIdString: {
                                    [Op.in]: this.tracingIdsOrDOIs
                                }
                            },
                            {
                                neuronDOI: {
                                    [Op.in]: this.tracingIdsOrDOIs
                                }
                            }
                        ]
                    };
                } else {
                    if (this.tracingIdsOrDOIs.length === 1) {
                        where = {
                            [Op.or]: [
                                {
                                    neuronIdString: {
                                        [Op.iLike]: `%${this.tracingIdsOrDOIs[0]}%`
                                    }
                                },
                                {
                                    neuronDOI: {
                                        [Op.iLike]: `%${this.tracingIdsOrDOIs[0]}%`
                                    }
                                }
                            ]
                        };
                    } else {
                        const ors = this.tracingIdsOrDOIs.map(id => {
                            return {
                                [Op.or]: [
                                    {
                                        neuronIdString: {
                                            [Op.iLike]: `%${id}%`
                                        }
                                    },
                                    {
                                        neuronDOI: {
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
                        const columnName = StructureIdentifier.countColumnName(s);

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
                    const columnName = StructureIdentifier.countColumnName(this.nodeStructureIds[0]);

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
