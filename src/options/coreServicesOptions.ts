import {Dialect, Options} from "sequelize";

export interface IGraphQLServiceOptions {
    host: string;
    port: number;
    graphQLEndpoint: string;
}

const databaseServices = {
    sample: {
        host: "nmcp-db",
        port: 5432,
        database: "nmcp_production",
        username: "postgres",
        password: "pgsecret",
        dialect: "postgres" as Dialect,
        logging: null
    }
};

const graphQLServices = {
    staticApi: {
        host: "static-api",
        port: 5000,
        graphQLEndpoint: "/graphql"
    }
};

const services = {
    database: databaseServices,
    graphQL: graphQLServices
};

function loadDatabaseOptions(options): any {
    options.sample.host = process.env.SAMPLE_DB_HOST || process.env.DATABASE_HOST || process.env.CORE_SERVICES_HOST || options.sample.host;
    options.sample.port = parseInt(process.env.SAMPLE_DB_PORT) || parseInt(process.env.DATABASE_PORT) || options.sample.port;
    options.sample.username = process.env.DATABASE_UN || options.sample.username;
    options.sample.password = process.env.DATABASE_PW || options.sample.password;

    return options;
}

function loadGraphQLOptions(options): any {
    options.staticApi.host = process.env.STATIC_API_HOST || process.env.CORE_SERVICES_HOST || options.staticApi.host;
    options.staticApi.port = parseInt(process.env.STATIC_API_PORT) || options.staticApi.port;
    options.staticApi.graphQLEndpoint = process.env.STATIC_API_ENDPOINT || process.env.CORE_SERVICES_ENDPOINT || options.staticApi.graphQLEndpoint;

    return options;
}

function loadConfiguration() {
    const c = Object.assign({}, services);

    c.database = loadDatabaseOptions(c.database);
    c.graphQL = loadGraphQLOptions(c.graphQL);

    return c;
}

export const CoreServiceOptions = loadConfiguration();

export const SequelizeOptions: Options = CoreServiceOptions.database.sample;

export const StaticServiceOptions: IGraphQLServiceOptions = CoreServiceOptions.graphQL.staticApi;
