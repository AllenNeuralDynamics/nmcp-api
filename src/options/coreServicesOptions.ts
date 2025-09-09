import {Dialect, Options} from "sequelize";

export interface IGraphQLServiceOptions {
    host: string;
    port: number;
    graphQLEndpoint: string;
}

const databaseServices = {
    nmcp: {
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

const restServices = {
    qualityCheck: {
        host: "quality-api",
        port: 5000,
        endpoint: "/performqc"
    }
}

const services = {
    database: databaseServices,
    graphQL: graphQLServices,
    rest: restServices
};

function loadDatabaseOptions(options): any {
    options.nmcp.host = process.env.NMCP_DB_HOST || options.nmcp.host;
    options.nmcp.port = parseInt(process.env.NMCP_DB_PORT) || options.nmcp.port;
    options.nmcp.username = process.env.NMCP_DATABASE_UN || options.nmcp.username;
    options.nmcp.password = process.env.NMCP_DATABASE_PW || options.nmcp.password;

    return options;
}

function loadGraphQLOptions(options): any {
    options.staticApi.host = process.env.STATIC_API_HOST || options.staticApi.host;
    options.staticApi.port = parseInt(process.env.STATIC_API_PORT) || options.staticApi.port;
    options.staticApi.graphQLEndpoint = process.env.STATIC_API_ENDPOINT || options.staticApi.graphQLEndpoint;

    return options;
}

function loadRestOptions(options): any {
    options.qualityCheck.host = process.env.QUALITY_API_HOST || options.qualityCheck.host;
    options.qualityCheck.port = parseInt(process.env.QUALITY_API_PORT) || options.qualityCheck.port;
    options.qualityCheck.endpoint = process.env.QUALITY_API_ENDPOINT || options.qualityCheck.endpoint;

    return options;
}

function loadConfiguration() {
    const c = Object.assign({}, services);

    c.database = loadDatabaseOptions(c.database);
    c.graphQL = loadGraphQLOptions(c.graphQL);
    c.rest = loadRestOptions(c.rest)

    return c;
}

export const CoreServiceOptions = loadConfiguration();

export const SequelizeOptions: Options = CoreServiceOptions.database.nmcp;

export const StaticServiceOptions: IGraphQLServiceOptions = CoreServiceOptions.graphQL.staticApi;
