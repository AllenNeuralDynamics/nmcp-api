import * as path from "path";

export interface IServiceOptions {
    port: number;
    graphQLEndpoint: string;
    fixturePath: string;
}

const configuration: IServiceOptions = {
    port: 5000,
    graphQLEndpoint: "/graphql",
    fixturePath: "fixtures"
};

function loadConfiguration() {
    const c = Object.assign({}, configuration);

    c.port = parseInt(process.env.SAMPLE_API_PORT) || c.port;
    c.graphQLEndpoint = process.env.SAMPLE_API_ENDPOINT || process.env.CORE_SERVICES_ENDPOINT || c.graphQLEndpoint;

    const prefix = (!process.env.NODE_ENV || process.env.NODE_ENV === "development") ? ".." : "";
    c.fixturePath =  path.normalize(path.join(__dirname, prefix, "..", c.fixturePath));

    return c;
}

export const ServiceOptions: IServiceOptions = loadConfiguration();
