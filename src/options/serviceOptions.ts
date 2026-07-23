import * as path from "path";
import * as fs from "fs";

export type EntraAuthenticationOptions = {
    apiAppId: string;
    tenantId: string;
}

type IServiceOptions = {
    port: number;
    graphQLEndpoint: string;
    requireAuthentication: boolean;
    entraAuthenticationOptions: EntraAuthenticationOptions;
    serverAuthenticationKey: string;
    fixturePath: string;
    seedUserItems: boolean;
    ccfv30OntologyPath: string;
    allowExperimentalFeatures: boolean;
    version: string;
}

const configuration: IServiceOptions = {
    port: 5000,
    graphQLEndpoint: "/graphql",
    fixturePath: "fixtures",
    requireAuthentication: process.env.NMCP_AUTH_REQUIRED !== "false",
    entraAuthenticationOptions: {
        apiAppId: process.env.NMCP_AUTHENTICATION_API_APP_ID,
        tenantId: process.env.NMCP_AUTHENTICATION_TENANT_ID
    },
    serverAuthenticationKey: process.env.NMCP_SERVER_KEY || null,
    seedUserItems: process.env.NMCP_SEED_USER_ITEMS === "true",
    ccfv30OntologyPath: "ccfv30_raw.nrrd",
    allowExperimentalFeatures:  process.env.NMCP_EXPERIMENTAL_ENV === "true",
    version: ""
};

function loadConfiguration() {
    const c = Object.assign({}, configuration);

    c.port = parseInt(process.env.NMCP_API_PORT) || c.port;
    c.graphQLEndpoint = process.env.NMCP_API_ENDPOINT || c.graphQLEndpoint;

    const prefix = (!process.env.NODE_ENV || process.env.NODE_ENV === "development") ? ".." : "";
    c.fixturePath = path.normalize(path.join(__dirname, prefix, "..", c.fixturePath));

    c.ccfv30OntologyPath = process.env.NMCP_CCF_30_ONTOLOGY_PATH || c.ccfv30OntologyPath;

    c.version = readSystemVersion();

    return c;
}

export const ServiceOptions: IServiceOptions = loadConfiguration();

function readSystemVersion(): string {
    try {
        const contents = JSON.parse(fs.readFileSync(path.resolve("package.json")).toString());
        return contents.version;
    } catch (err) {
        console.log(err);
        return "";
    }
}
