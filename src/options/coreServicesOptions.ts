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
    },
    doiGeneration: {
        url: "https://morphology.allenneuraldynamics-test.org/",
        host: "api.test.datacite.org",
        port: 443,
        endpoint: "/dois",
        prefix: "10.83594",
        user: "",
        password: ""
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

    options.doiGeneration.url = process.env.DOI_API_URL || options.doiGeneration.url;
    options.doiGeneration.host = process.env.DOI_API_HOST || options.doiGeneration.host;
    options.doiGeneration.endpoint = process.env.DOI_API_ENDPOINT || options.doiGeneration.endpoint;
    options.doiGeneration.prefix = process.env.DOI_API_PREFIX || options.doiGeneration.prefix;
    options.doiGeneration.user = process.env.DOI_API_USER || options.doiGeneration.user;
    options.doiGeneration.password = process.env.DOI_API_PASSWORD || options.doiGeneration.password;

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
