import * as os from "os";
import * as express from "express";
import * as bodyParser from "body-parser";
import * as cors from 'cors';
import {ApolloServer} from '@apollo/server';
import {expressMiddleware} from '@apollo/server/express4';

const graphqlUploadExpress = require('graphql-upload/graphqlUploadExpress.js');
const debug = require("debug")("mnb:sample-api:server");

import {ServiceOptions} from "./options/serviceOptions";
import typeDefinitions from "./graphql/typeDefinitions";
import {resolvers} from "./graphql/serverResolvers";
import {RemoteDatabaseClient} from "./data-access/remoteDatabaseClient";
import {GraphQLError} from "graphql/error";

import {jwtDecode} from "jwt-decode";
import moment = require("moment");
import {tracingQueryMiddleware} from "./rawquery/tracingQueryMiddleware";

const config = require('./authConfig.json');

start().then().catch((err) => debug(err));

async function start() {
    await RemoteDatabaseClient.Start(true);

    const app = express();

    app.use(bodyParser.urlencoded({extended: true}));

    app.use(bodyParser.json());

    app.use("/tracings", tracingQueryMiddleware);

    const server = new ApolloServer({
        typeDefs: typeDefinitions,
        resolvers,
        introspection: true,
        csrfPrevention: false
    });

    app.use(graphqlUploadExpress())

    await server.start();

    const requireAuthentication = ServiceOptions.requireAuthentication;

    app.use(
        ServiceOptions.graphQLEndpoint,
        cors<cors.CorsRequest>(),
        express.json(),
        expressMiddleware(server, {
            context: async ({req, res}) => {
                const token = req.headers.authorization || "null";

                if (requireAuthentication) {
                    const scopes = validateToken(token);

                    if (scopes == null) {
                        throw new GraphQLError('User is not authenticated', {
                            extensions: {
                                code: 'UNAUTHENTICATED',
                                http: {status: 401},
                            },
                        });
                    }
                }

                return token;
            }
        })
    );

    app.listen(ServiceOptions.port, () => debug(`sample api server is now running on http://${os.hostname()}:${ServiceOptions.port}/graphql`));
}

const authOptions = {
    identityMetadata: `https://${config.credentials.tenantName}.b2clogin.com/${config.credentials.tenantName}.onmicrosoft.com/${config.policies.policyName}/${config.metadata.version}/${config.metadata.discovery}`,
    clientID: config.credentials.clientID,
    audience: config.resource.audience,
    policyName: config.policies.policyName,
    isB2C: config.settings.isB2C,
    validateIssuer: config.settings.validateIssuer,
    loggingLevel: config.settings.loggingLevel,
    passReqToCallback: config.settings.passReqToCallback
}

function validateToken(token: string): string[] {
    let decoded = null;

    try {
        decoded = jwtDecode(token);
    } catch {
        return null;
    }

    if (decoded.aud != authOptions.audience) {
        return null;
    }

    //@ts-ignore
    if (decoded.tfp != authOptions.policyName) {
        return null;
    }

    //@ts-ignore
    if (decoded.azp != authOptions.clientID) {
        return null;
    }

    let now = moment.utc().valueOf()

    // JWT time is in seconds
    if (now < decoded.nbf * 1000 || now > decoded.exp * 1000) {
        return null;
    }

    //@ts-ignore
    return decoded.scp.split(" ");
}