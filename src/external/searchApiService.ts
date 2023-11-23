import {ApolloClient, HttpLink, InMemoryCache} from "@apollo/client/core";

const gql = require("graphql-tag");

require("isomorphic-fetch");

const debug = require("debug")("mnb:sample-api:search-client");

import {SearchServiceOptions} from "../options/coreServicesOptions";

export class SearchApiClient {
    private _client: ApolloClient<any>;

    public constructor() {
        const url = `http://${SearchServiceOptions.host}:${SearchServiceOptions.port}/${SearchServiceOptions.graphQLEndpoint}`;

        debug(`creating apollo client for search service ${url}`);

        this._client = new ApolloClient({
            link: new HttpLink({uri: url}),
            cache: new InMemoryCache()
        });
    }

    public async syncBrainAreas(): Promise<void> {
        await this._client.mutate({
            mutation: gql`
                mutation {
                  syncBrainAreas 
                }`
        });
    }
}

export const searchApiClient = new SearchApiClient();
