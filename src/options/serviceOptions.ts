import * as path from "path";
import * as fs from "fs";

export enum ReleaseLevel {
    Internal = 0,
    Public
}

export interface IServiceOptions {
    port: number;
    graphQLEndpoint: string;
    fixturePath: string;
    requireAuthentication: boolean;
    seedUserItems: boolean;
    ccfv30OntologyPath: string;
    tracingLoadMaxDelay: number;
    tracingLoadLimit: number;
    release: ReleaseLevel;
    version: string;
}

const configuration: IServiceOptions = {
    port: 5000,
    graphQLEndpoint: "/graphql",
    fixturePath: "fixtures",
    requireAuthentication: true,
    seedUserItems: false,
    ccfv30OntologyPath: "ccfv30_raw.nrrd",
    tracingLoadMaxDelay: 10,
    tracingLoadLimit: 100,
    release: ReleaseLevel.Public,
    version: ""
};

function loadConfiguration() {
    const c = Object.assign({}, configuration);

    c.port = parseInt(process.env.SAMPLE_API_PORT) || c.port;
    c.graphQLEndpoint = process.env.SAMPLE_API_ENDPOINT || process.env.CORE_SERVICES_ENDPOINT || c.graphQLEndpoint;

    const prefix = (!process.env.NODE_ENV || process.env.NODE_ENV === "development") ? ".." : "";
    c.fixturePath =  path.normalize(path.join(__dirname, prefix, "..", c.fixturePath));

    c.requireAuthentication = process.env.NMCP_AUTH_REQUIRED !== "false"
    c.seedUserItems =  process.env.NMCP_SEED_USER_ITEMS === "true"

    c.ccfv30OntologyPath = process.env.CCF_30_ONTOLOGY_PATH || c.ccfv30OntologyPath;

    c.tracingLoadMaxDelay = parseInt(process.env.NEURON_BROWSER_LOAD_MAX_DELAY) || c.tracingLoadMaxDelay;
    c.tracingLoadLimit = parseInt(process.env.NEURON_BROWSER_LOAD_LIMIT) || c.tracingLoadLimit;

    c.release = process.env.SEARCH_API_RELEASE_LEVEL ? ReleaseLevel[process.env.SEARCH_API_RELEASE_LEVEL] : c.release;
    c.release = c.release === undefined ? ReleaseLevel.Public : c.release;
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
