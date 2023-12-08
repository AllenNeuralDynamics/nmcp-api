import * as uuid from "uuid"

import {SearchScope} from "./SearchScope";

import {IPredicateAttributes, IQueryPredicate, QueryPredicate} from "./queryPredicate";

export enum CcfVersion {
    Ccf25,
    Ccf30
}

export interface ISearchContextInput {
    nonce: string;
    scope: SearchScope;
    ccfVersion: CcfVersion;
    predicates: IPredicateAttributes[];
}

export class SearchContext {
    public static fromPredicates(nonce: string = "", predicates: IQueryPredicate[] = []): SearchContext {
        return new SearchContext({
            nonce,
            scope: SearchScope.Public,
            ccfVersion: CcfVersion.Ccf25,
            predicates
        });
    }

    private static createDefault(): ISearchContextInput {
        return {
            scope: SearchScope.Public,
            nonce: uuid.v4(),
            ccfVersion: CcfVersion.Ccf30,
            predicates: [QueryPredicate.createDefault()]
        }
    }

    public constructor(input: ISearchContextInput) {
        input = input || SearchContext.createDefault();

        this._nonce = input.nonce;
        this._scope = input.scope;
        this._ccfVersion = input.ccfVersion;
        this._predicates = (!input.predicates || input.predicates.length === 0) ? [QueryPredicate.createDefault()] : input.predicates.map(p => new QueryPredicate(p));
    }

    private readonly _scope: SearchScope;

    public get Scope(): SearchScope {
        return this._scope;
    }

    private readonly _nonce: string;

    public get Nonce(): string {
        return this._nonce;
    }

    private readonly _ccfVersion: CcfVersion;

    public get CcfVersion(): CcfVersion {
        return this._ccfVersion;
    }

    private readonly _predicates: IQueryPredicate[];

    public get Predicates(): IQueryPredicate[] {
        return this._predicates;
    }
}