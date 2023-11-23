import {Dialect, Options} from "sequelize";

export interface IGraphQLServiceOptions {
    host: string;
    port: number;
    graphQLEndpoint: string;
}

const databaseServices = {
    sample: {
        host: "sample-db",
        port: 5432,
        database: "samples_production",
        username: "postgres",
        password: "pgsecret",
        dialect: "postgres" as Dialect,
        logging: null
    }
};

const graphQLServices = {
    swc: {
        host: "swc-api",
        port: 5000,
        graphQLEndpoint: "graphql"
    },
    transform: {
        host: "transform-api",
        port: 5000,
        graphQLEndpoint: "graphql"
    },
    search: {
        host: "search-api",
        port: 5000,
        graphQLEndpoint: "graphql"
    }
};

const services = {
    database: databaseServices,
    graphQL: graphQLServices
};

function loadDatabaseOptions(options): any {
    options.sample.host = process.env.SAMPLE_DB_HOST || process.env.DATABASE_HOST || process.env.CORE_SERVICES_HOST || options.sample.host;
    options.sample.port = parseInt(process.env.SAMPLE_DB_PORT) || parseInt(process.env.DATABASE_PORT) || options.sample.port;
    options.sample.password = process.env.DATABASE_PW || options.sample.password;

    return options;
}

function loadGraphQLOptions(options): any {
    options.swc.host = process.env.SWC_API_HOST || process.env.CORE_SERVICES_HOST || options.swc.host;
    options.swc.port = parseInt(process.env.SWC_API_PORT) || options.swc.port;
    options.swc.graphQLEndpoint = process.env.SWC_API_ENDPOINT || process.env.CORE_SERVICES_ENDPOINT || options.swc.graphQLEndpoint;

    options.transform.host = process.env.TRANSFORM_API_HOST || process.env.CORE_SERVICES_HOST || options.transform.host;
    options.transform.port = parseInt(process.env.TRANSFORM_API_PORT) || options.transform.port;
    options.transform.graphQLEndpoint = process.env.TRANSFORM_API_ENDPOINT || process.env.CORE_SERVICES_ENDPOINT || options.transform.graphQLEndpoint;

    options.search.host = process.env.SEARCH_API_HOST || process.env.CORE_SERVICES_HOST || options.search.host;
    options.search.port = parseInt(process.env.SEARCH_API_PORT) || options.search.port;
    options.search.graphQLEndpoint = process.env.SEARCH_API_ENDPOINT || process.env.CORE_SERVICES_ENDPOINT || options.search.graphQLEndpoint;

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

export const SwcServiceOptions: IGraphQLServiceOptions = CoreServiceOptions.graphQL.swc;

export const TransformServiceOptions: IGraphQLServiceOptions = CoreServiceOptions.graphQL.transform;

export const SearchServiceOptions: IGraphQLServiceOptions = CoreServiceOptions.graphQL.search;
