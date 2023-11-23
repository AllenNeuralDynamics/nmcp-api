import {ApolloClient, HttpLink, InMemoryCache} from "@apollo/client/core";

const gql = require("graphql-tag");

require("isomorphic-fetch");

const debug = require("debug")("mnb:sample-api:swc-client");

import {SwcServiceOptions} from "../options/coreServicesOptions";
import {EntityCountOutput, EntityType} from "../models/baseModel";
import * as _ from "lodash";

export class SwcApiClient {
    private _client: any;

    constructor() {
        const url = `http://${SwcServiceOptions.host}:${SwcServiceOptions.port}/${SwcServiceOptions.graphQLEndpoint}`;

        debug(`creating apollo client for SWC service ${url}`);

        this._client = new ApolloClient({
            link: new HttpLink({uri: url}),
            cache: new InMemoryCache()
        });
    }

    public static async tracingCountsForNeurons(ids: string[]): Promise<EntityCountOutput> {
        try {
            const out = await swcApiClient.requestTracingsForNeurons(ids);

            const groups = _.groupBy(out.data.tracings.tracings, "neuron.id");

            const counts = [];

            if (ids.length === 0) {
                for (const id in groups) {
                    counts.push({
                        id,
                        count: groups[id].length
                    });
                }
            } else {
                ids.map(id => {
                    counts.push({
                        id,
                        count: groups[id] !== undefined ? groups[id].length : 0
                    });
                });
            }

            return {entityType: EntityType.Neuron, counts, error: null};
        } catch (err) {
            debug(err.message);
            return {entityType: EntityType.Neuron, counts: [], error: err.message};
        }
    }

    private requestTracingsForNeurons(neuronIds: string[]) {
        return this._client.query({
            query: gql`
                query($ids: [String!]) {
                  tracings(pageInput: {neuronIds: $ids}) {
                    tracings {
                      id
                      neuron {
                        id
                      }
                    }
                  }
                }`,
            variables: {
                ids: neuronIds
            },
            fetchPolicy: "network-only"
        });
    }

    public deleteTracingsForNeurons(ids: string[]) {
        return this._client.mutate({
            mutation: gql`
                mutation DeleteTracingsForNeurons($neuronIds: [String!]) {
                    deleteTracingsForNeurons(neuronIds: $neuronIds) {
                        error {
                            name
                            message
                        }
                    }
                }`,
            variables: {
                neuronIds: ids
            }
        });
    }
}

export const swcApiClient = new SwcApiClient();
