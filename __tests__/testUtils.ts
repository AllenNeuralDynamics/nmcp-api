import * as fs from "fs";
import * as path from "path";
import uuid = require("uuid");
import {Dialect} from "sequelize";
import {ApolloServer} from "apollo-server";
import {ApolloServerTestClient, createTestClient} from "apollo-server-testing";

import {RemoteDatabaseClient} from "../src/data-access/remoteDatabaseClient";
import typeDefinitions from "../src/graphql/typeDefinitions";
import {resolvers} from "../src/graphql/serverResolvers";

export const copyDatabase = async (): Promise<string> => {
    const tempName = `${uuid.v4()}.sqlite`;

    fs.copyFileSync(path.join(__dirname, "test-template.sqlite"), path.join(__dirname, tempName));

    await RemoteDatabaseClient.Start({
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
        resolvers
    });

    return createTestClient(server);
}