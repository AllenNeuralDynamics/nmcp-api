import {ApolloClient, HttpLink, InMemoryCache} from "@apollo/client/core";

import gql from "graphql-tag";
import * as _ from "lodash";

require("isomorphic-fetch");

const debug = require("debug")("mnb:sample-api:transform-client");

import {TransformServiceOptions} from "../options/coreServicesOptions";
import {EntityCountOutput, EntityType} from "../models/baseModel";

export class TransformApiClient {
    private _client: any;

    public constructor() {
        const url = `http://${TransformServiceOptions.host}:${TransformServiceOptions.port}/${TransformServiceOptions.graphQLEndpoint}`;

        debug(`creating apollo client for transform service ${url}`);

        this._client = new ApolloClient({
            link: new HttpLink({uri: url}),
            cache: new InMemoryCache()
        });
    }

    public static async queryTracingsForTransforms(ids: string[]): Promise<EntityCountOutput> {
        try {
            const out = await transformClient.requestTracingsForTransforms(ids);

            const groups = _.groupBy(out.data.tracings.tracings, "registrationTransform.id");

            const counts = [];

            if (ids.length === 0) {
                for (const id in groups) {
                    counts.push({
                        transformId: id,
                        count: groups[id].length
                    });
                }
            } else {
                ids.map(id => {
                    counts.push({
                        id: id,
                        count: groups[id] !== undefined ? groups[id].length : 0
                    });
                });
            }

            return {entityType: EntityType.RegistrationTransform, counts, error: null};
        } catch (err) {
            debug(err.message);
            return {entityType: EntityType.RegistrationTransform, counts: [], error: err.message};
        }
    }

    private requestTracingsForTransforms(registrationTransformIds: string[]) {
        return this._client.query({
            query: gql`
                query($ids: [String!]) {
                  tracings(queryInput: {registrationTransformIds: $ids}) {
                    tracings {
                      id
                      registrationTransform {
                        id
                      }
                    }
                  }
                }`,
            variables: {
                ids: registrationTransformIds
            },
            fetchPolicy: "network-only"
        });
    }
}

export const transformClient = new TransformApiClient();
