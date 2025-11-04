import * as uuid from "uuid"

import {IPredicateAttributes, IQueryPredicate, QueryPredicate} from "./queryPredicate";

export type SearchContextInput = {
    nonce: string;
    predicates: IPredicateAttributes[];
}

export class SearchContext {
    private static createDefault(): SearchContextInput {
        return {
            nonce: uuid.v4(),
            predicates: [QueryPredicate.createDefault()]
        }
    }

    private readonly _nonce: string;

    private readonly _predicates: IQueryPredicate[];

    public constructor(input: SearchContextInput) {
        input = input || SearchContext.createDefault();

        this._nonce = input.nonce;
        this._predicates = (!input.predicates || input.predicates.length === 0) ? [QueryPredicate.createDefault()] : input.predicates.map(p => new QueryPredicate(p));
    }

    public get Nonce(): string {
        return this._nonce;
    }

    public get Predicates(): IQueryPredicate[] {
        return this._predicates;
    }
}
