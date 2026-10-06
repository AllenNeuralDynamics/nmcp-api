import * as uuid from "uuid"

import {PredicateShape, QueryPredicate} from "./queryPredicate";

export type SearchContextInput = {
    nonce: string;
    collectionIds: string[];
    atlasKindIds?: string[];
    predicates: PredicateShape[];
}

export class SearchContext {
    private static createDefault(): SearchContextInput {
        return {
            nonce: uuid.v4(),
            collectionIds: [],
            atlasKindIds: [],
            predicates: [QueryPredicate.createDefault()]
        }
    }

    private readonly _nonce: string;

    private readonly _collectionIds: string[];

    private readonly _atlasKindIds: string[];

    private readonly _predicates: QueryPredicate[];

    public constructor(input: SearchContextInput) {
        input = input ?? SearchContext.createDefault();

        this._nonce = input.nonce;
        this._collectionIds = input.collectionIds;
        this._atlasKindIds = input.atlasKindIds ?? [];
        this._predicates = (!input.predicates || input.predicates.length === 0) ? [QueryPredicate.createDefault()] : input.predicates.map(p => new QueryPredicate(p));
    }

    public get Nonce(): string {
        return this._nonce;
    }

    public get CollectionIds(): string[] {
        return this._collectionIds;
    }

    public get AtlasKindIds(): string[] {
        return this._atlasKindIds;
    }

    public get Predicates(): QueryPredicate[] {
        return this._predicates;
    }
}
