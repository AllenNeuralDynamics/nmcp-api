import {Dialect, Options} from "sequelize";

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

const restServices = {
    qualityCheck: {
        host: "quality-api",
        port: 5000,
        endpoint: "/performqc"
    }
}

const services = {
    database: databaseServices,
    rest: restServices
};

function loadDatabaseOptions(options): any {
    // @ts-ignore
    options.nmcp.host = process.env.NMCP_DB_HOST || options.nmcp.host;
    options.nmcp.port = parseInt(process.env.NMCP_DB_PORT) || options.nmcp.port;
    options.nmcp.username = process.env.NMCP_DATABASE_UN || options.nmcp.username;
    options.nmcp.password = process.env.NMCP_DATABASE_PW || options.nmcp.password;

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
    c.rest = loadRestOptions(c.rest)

    return c;
}

export const CoreServiceOptions = loadConfiguration();

export const SequelizeOptions: Options = CoreServiceOptions.database.nmcp;
