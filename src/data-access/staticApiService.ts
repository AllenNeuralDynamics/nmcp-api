import {HttpLink} from "apollo-link-http";
import {ApolloClient} from "apollo-client";
import {InMemoryCache} from "apollo-cache-inmemory";

const gql = require("graphql-tag");

const debug = require("debug")("mnb:sample-api:swc-client");

import {StaticServiceOptions} from "../options/coreServicesOptions";

export class StaticApiClient {
    private _client: any;

    constructor() {
        const url = `http://${StaticServiceOptions.host}:${StaticServiceOptions.port}/${StaticServiceOptions.graphQLEndpoint}`;

        debug(`creating apollo client for static service ${url}`);

        this._client = new ApolloClient({
            link: new HttpLink({uri: url, fetch: fetch}),
            cache: new InMemoryCache()
        });
    }

    querySampleTomography() {
        return this._client.query({
            query: gql`
                query {
                  tomographyMetadata {
                    id
                    name
                    origin
                    pixelSize
                    threshold
                    limits {
                      horizontal
                      sagittal
                      coronal
                    }
                  }
                }`,
            fetchPolicy: "network-only"
        });
    }
}

export const staticApiClient = new StaticApiClient();
