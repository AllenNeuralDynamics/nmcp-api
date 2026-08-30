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
    trustedProxyHops: number;
    recentRequestAddressLimit: number;
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
    // Number of proxies that append to X-Forwarded-For between the client and this process, which decides which entry
    // Express reports as req.ip.  One covers the deployed shape of client -> https gateway -> container: NAT hops such
    // as Docker's published-port mapping rewrite the source address but add no header entry, so they do not count.
    // Raise it if another appending proxy (a CDN, a second load balancer) is put in front, and set 0 when the process
    // is reachable directly - a hop count higher than reality lets a client spoof the header and pick its own address.
    trustedProxyHops: 1,
    // How many recent request addresses to hold in memory for the internal diagnostics query.  Zero disables it.
    recentRequestAddressLimit: 50,
    version: ""
};

function loadConfiguration() {
    const c = Object.assign({}, configuration);

    c.port = parseInt(process.env.NMCP_API_PORT) || c.port;
    c.graphQLEndpoint = process.env.NMCP_API_ENDPOINT || c.graphQLEndpoint;

    const prefix = (!process.env.NODE_ENV || process.env.NODE_ENV === "development") ? ".." : "";
    c.fixturePath = path.normalize(path.join(__dirname, prefix, "..", c.fixturePath));

    c.ccfv30OntologyPath = process.env.NMCP_CCF_30_ONTOLOGY_PATH || c.ccfv30OntologyPath;

    // Not the `parseInt(...) || default` idiom used above: zero is a meaningful setting here and would be discarded.
    const trustedProxyHops = parseInt(process.env.NMCP_TRUSTED_PROXY_HOPS);
    c.trustedProxyHops = Number.isNaN(trustedProxyHops) ? c.trustedProxyHops : trustedProxyHops;

    const recentRequestAddressLimit = parseInt(process.env.NMCP_RECENT_REQUEST_ADDRESS_LIMIT);
    c.recentRequestAddressLimit = Number.isNaN(recentRequestAddressLimit) ? c.recentRequestAddressLimit : recentRequestAddressLimit;

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
