import * as fs from "fs";
import * as path from "path";
import uuid = require("uuid");
import {Dialect} from "sequelize";
import {ApolloServer} from "apollo-server";
import {ApolloServerTestClient, createTestClient} from "apollo-server-testing";
import { merge } from 'lodash';

import {RemoteDatabaseClient} from "../src/data-access/remoteDatabaseClient";
import typeDefinitions from "../src/graphql/typeDefinitions";
import {openResolvers} from "../src/graphql/secureResolvers";
import {secureResolvers} from "../src/graphql/secureResolvers";

export const copyDatabase = async (): Promise<string> => {
    const tempName = `${uuid.v4()}.sqlite`;

    fs.copyFileSync(path.join(__dirname, "test-template.sqlite"), path.join(__dirname, tempName));

    await RemoteDatabaseClient.Start(false, {
        dialect: "sqlite" as Dialect,
        storage: path.join(__dirname, tempName),
        logging: null
    });

    return tempName;
};

export const removeDatabase = (name) => {
    if (fs.existsSync(path.join(__dirname, name))) {
        fs.unlinkSync(path.join(__dirname, name));
    }
};

export function createServerTestClient(): ApolloServerTestClient {
    const server = new ApolloServer({
        typeDefs: typeDefinitions,
        resolvers: merge(openResolvers, secureResolvers)
    });

    return createTestClient(server);
}
