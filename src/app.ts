import * as os from "os";
import * as express from "express";
import * as bodyParser from "body-parser";
import * as cors from "cors";
import {ApolloServer} from '@apollo/server';
import {expressMiddleware} from '@apollo/server/express4';

const graphqlUploadExpress = require('graphql-upload/graphqlUploadExpress.js');
import {jwtDecode} from "jwt-decode";
import moment = require("moment");

const debug = require("debug")("mnb:nmcp-api:server");

import {ServiceOptions} from "./options/serviceOptions";
import {RemoteDatabaseClient} from "./data-access/remoteDatabaseClient";

import {synchronizationManagerStart} from "./synchronization/synchonizationManager";
import {User} from "./models/user";
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

    app.use(
        ServiceOptions.graphQLEndpoint,
        cors<cors.CorsRequest>(),
        express.json(),
        expressMiddleware(server, {
            context: async ({req, res}) => {
                const token = req.headers.authorization || null;

                let user = null;

                if (requireAuthentication) {
                    if (ServiceOptions.serverAuthenticationKey != null && token == ServiceOptions.serverAuthenticationKey) {
                        return User.SystemInternalUser;
                    }

                    let [scopes, tokenUser] = await validateToken(token);

                    if (scopes != null) {
                        user = tokenUser;
                    }
                }

                return user || User.SystemNoUser;
            }
        })
    );

    app.listen(ServiceOptions.port, () => debug(`nmcp api server is now running on http://${os.hostname()}:${ServiceOptions.port}/graphql`));
}

export type TokenOutput = [scopes: string[], user: User];

async function validateToken(token: string): Promise<TokenOutput> {
    if (token == null) {
        return [[], null];
    }

    let decoded = null;

    try {
        decoded = jwtDecode(token);
    } catch {
        return [[], null];
    }
    
    //@ts-ignore
    if (decoded.appid != ServiceOptions.b2cAuthenticationOptions.clientId) {
        return [[], null];
    }

    let now = moment.utc().valueOf()

    // JWT time is in seconds
    if (now < decoded.nbf * 1000 || now > decoded.exp * 1000) {
        return [[], null];
    }

    let upn = (decoded["upn"] && decoded.upn.length > 0) ? decoded.upn : "";

    if (!upn && decoded.email) {
        // Guest accounts in the directory will generally have email populated rather than upn for email address.
        upn = decoded.email;
    }

    //@ts-ignore
    const user = await User.findOrCreateUser(decoded.oid, decoded.given_name, decoded.family_name, upn);

    //@ts-ignore
    return [decoded.scp.split(" "), user];
}
