import * as os from "os";
import * as express from "express";
import * as cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
const graphqlUploadExpress =require('graphql-upload/graphqlUploadExpress.js');
const debug = require("debug")("mnb:sample-api:server");

import {ServiceOptions} from "./options/serviceOptions";
import typeDefinitions from "./graphql/typeDefinitions";
import {resolvers} from "./graphql/serverResolvers";
import {RemoteDatabaseClient} from "./data-access/remoteDatabaseClient";

start().then().catch((err) => debug(err));

async function start() {
    await RemoteDatabaseClient.Start();

    const app = express();

    const server = new ApolloServer({
        typeDefs: typeDefinitions,
        resolvers,
        introspection: true
    });

    app.use(graphqlUploadExpress());

    await server.start();

    app.use(
        ServiceOptions.graphQLEndpoint,
        cors<cors.CorsRequest>(),
        express.json(),
        expressMiddleware(server),
    );

    app.listen(ServiceOptions.port, () => debug(`sample api server is now running on http://${os.hostname()}:${ServiceOptions.port}/graphql`));
}
