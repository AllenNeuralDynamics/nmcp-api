import * as path from "path";
import * as fs from "fs";

type B2CAuthenticationOptions = {
    tenantName: string;
    audience: string;
    clientId: string;
    policyName: string;
}

type IServiceOptions = {
    port: number;
    graphQLEndpoint: string;
    requireAuthentication: boolean;
    b2cAuthenticationOptions: B2CAuthenticationOptions;
    serverAuthenticationKey: string;
    fixturePath: string;
    seedUserItems: boolean;
    ccfv30OntologyPath: string;
    tracingLoadMaxDelay: number;
    tracingLoadLimit: number;
    version: string;
}

const configuration: IServiceOptions = {
    port: 5000,
    graphQLEndpoint: "/graphql",
    fixturePath: "fixtures",
    requireAuthentication: process.env.NMCP_AUTH_REQUIRED !== "false",
    b2cAuthenticationOptions: {
        tenantName: process.env.NMCP_AUTHENTICATION_TENANT_NAME || "",
        audience: process.env.NMCP_AUTHENTICATION_AUDIENCE || "",
        clientId: process.env.NMCP_AUTHENTICATION_CLIENT_ID || "",
        policyName: process.env.NMCP_AUTHENTICATION_POLICY_NAME || "B2C_1_susi"
    },
    serverAuthenticationKey: process.env.NMCP_AUTHENTICATION_KEY || null,
    seedUserItems: process.env.NMCP_SEED_USER_ITEMS === "true",
    ccfv30OntologyPath: "ccfv30_raw.nrrd",
    tracingLoadMaxDelay: 10,
    tracingLoadLimit: 100,
    version: ""
};

function loadConfiguration() {
    const c = Object.assign({}, configuration);

    c.port = parseInt(process.env.NMCP_API_PORT) || c.port;
    c.graphQLEndpoint = process.env.NMCP_API_ENDPOINT || c.graphQLEndpoint;

    const prefix = (!process.env.NODE_ENV || process.env.NODE_ENV === "development") ? ".." : "";
    c.fixturePath = path.normalize(path.join(__dirname, prefix, "..", c.fixturePath));

    c.ccfv30OntologyPath = process.env.NMCP_CCF_30_ONTOLOGY_PATH || c.ccfv30OntologyPath;

    c.tracingLoadMaxDelay = parseInt(process.env.NMCP_LOAD_MAX_DELAY) || c.tracingLoadMaxDelay;
    c.tracingLoadLimit = parseInt(process.env.NMCP_BROWSER_LOAD_LIMIT) || c.tracingLoadLimit;

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
