import * as os from "os";
import * as express from "express";
import * as bodyParser from "body-parser";
import * as cors from "cors";
import {ApolloServer} from '@apollo/server';
import {expressMiddleware} from '@apollo/server/express4';

const graphqlUploadExpress = require('graphql-upload/graphqlUploadExpress.js');

const debug = require("debug")("mnb:nmcp-api:server");

import {ServiceOptions} from "./options/serviceOptions";
import {RemoteDatabaseClient} from "./data-access/remoteDatabaseClient";
import {initializeTokenVerifier, validateToken} from "./data-access/auth/tokenVerifier";

import {synchronizationManagerStart} from "./synchronization/synchonizationManager";
import {User} from "./models/user";
import {ApiKey} from "./models/apiKey";
import {typeDefinitions} from "./graphql/typeDefinitions";
import {merge} from "lodash";
import {openResolvers} from "./graphql/openResolvers";
import {secureResolvers} from "./graphql/secureResolvers";
import {internalResolvers} from "./graphql/internalResolvers";

start().then().catch((err) => debug(err));

async function start() {
    await RemoteDatabaseClient.Start(true, true);

    synchronizationManagerStart();

    const app = express();

    app.use(bodyParser.urlencoded({extended: true, limit: "1000mb"}));

    app.use(bodyParser.json({limit: "1000mb"}));

    const server = new ApolloServer<User>({
        typeDefs: typeDefinitions,
        resolvers: merge(openResolvers, secureResolvers, internalResolvers),
        introspection: process.env.NODE_ENV === "development" || process.env.NMCP_EXPERIMENTAL_ENV === "true",
        csrfPrevention: false
    });

    app.use(graphqlUploadExpress())

    await server.start();

    const requireAuthentication = ServiceOptions.requireAuthentication;

    if (requireAuthentication) {
        await initializeTokenVerifier();
    }

    app.use(
        ServiceOptions.graphQLEndpoint,
        cors<cors.CorsRequest>(),
        express.json(),
        expressMiddleware(server, {
            context: async ({req, res}) => {
                const authorization = req.headers.authorization || null;

                let user = null;

                if (requireAuthentication) {
                    let [scopes, tokenUser] = await validateToken(authorization);

                    if (scopes != null) {
                        user = tokenUser;
                    }

                    // The API key path compares the header value exactly, so it receives the unmodified header.
                    if (!user) {
                        user = await ApiKey.authenticateKey(authorization);
                    }
                }

                user = user ?? User.SystemNoUser;

                // Not really async safe for SystemNoUser.  Is only going to be used for the request access mutation,
                // and the likelihood of overlapping queries triggering rate limiting seems low.  If that ever becomes
                // an issue, can property return user an ip as the context.  Will just have to update all the resolvers
                // to destructure for user.
                user.ip = req.socket.remoteAddress;

                return user;
            }
        })
    );

    app.get("/health", async (_req, res) => {
        // optionally check DB connectivity here
        res.status(200).send("ok");
    });

    app.listen(ServiceOptions.port, () => debug(`nmcp api server is now running on http://${os.hostname()}:${ServiceOptions.port}/graphql`));
}

export {TokenOutput} from "./data-access/auth/tokenVerifier";
