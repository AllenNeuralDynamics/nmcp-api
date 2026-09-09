import {CoreServiceOptions} from "../../options/coreServicesOptions";

const debug = require("debug")("nmcp:nmcp-api:datacite-service");

export type DataCiteCreator = {
    name: string;
}

export type DataCiteTitle = {
    title: string;
}

export type DataCiteResourceType = {
    resourceTypeGeneral: string;
}

export type DataCiteSubject = {
    subject: string;
}

export type DataCiteContributor = {
    name: string;
    contributorType: string;
}

export type DataCiteAlternateIdentifier = {
    alternateIdentifier: string;
    alternateIdentifierType: string;
}

export type DataCiteAttributes = {
    // Optional so a create can land in DataCite's draft state: a draft is reserved but does not resolve and is not a
    // public record, which is what lets the DOI phase reserve, record locally, and only then promote to findable.
    event?: string;
    prefix: string;
    creators: DataCiteCreator[];
    titles: DataCiteTitle[];
    publisher: string;
    publicationYear: number;
    types: DataCiteResourceType;
    url: string;
    subjects?: DataCiteSubject[];
    contributors?: DataCiteContributor[];
    alternateIdentifiers?: DataCiteAlternateIdentifier[];
    relatedIdentifiers?: DataCiteRelatedIdentifier[];
    version?: number;
    rights?: string;
}

export type DataCiteRequestData = {
    type: string;
    attributes: DataCiteAttributes;
}

export type DataCiteRequest = {
    data: DataCiteRequestData;
}

export type DataCiteResponseCreator = {
    name: string;
    affiliation: string[];
    nameIdentifiers: string[];
}

export type DataCiteResponseTitle = {
    title: string;
}

export type DataCiteResponseTypes = {
    schemaOrg: string;
    citeproc: string;
    bibtex: string;
    ris: string;
    resourceTypeGeneral: string;
}

export type DataCiteRelationshipEntry = {
    id: string;
    type: string;
}

export type DataCiteRelatedIdentifierType = "DOI" | "URL" | "Handle" | "ISBN" | "ISSN" | "PMID" | "PURL" | "URN";

export type DataCiteRelationType = "IsVersionOf" | "HasVersion";

export type DataCiteRelatedIdentifier = {
    relatedIdentifier?: string;
    relatedIdentifierType: DataCiteRelatedIdentifierType;
    relationType: DataCiteRelationType;
    resourceTypeGeneral: string;
}

export type DataCiteResponseAttributes = {
    doi: string;
    prefix: string;
    suffix: string;
    identifiers: unknown[];
    alternateIdentifiers: unknown[];
    creators: DataCiteResponseCreator[];
    titles: DataCiteResponseTitle[];
    publisher: string;
    container: Record<string, unknown>;
    publicationYear: number;
    subjects: unknown[];
    contributors: unknown[];
    dates: unknown[];
    language: string | null;
    types: DataCiteResponseTypes;
    relatedIdentifiers: DataCiteRelatedIdentifier[];
    relatedItems: unknown[];
    sizes: unknown[];
    formats: unknown[];
    version: string | null;
    rightsList: unknown[];
    descriptions: unknown[];
    geoLocations: unknown[];
    fundingReferences: unknown[];
    xml: string;
    url: string;
    contentUrl: string | null;
    metadataVersion: number;
    schemaVersion: string | null;
    source: string;
    isActive: boolean;
    state: string;
    reason: string | null;
    landingPage: unknown | null;
    viewCount: number;
    viewsOverTime: unknown[];
    downloadCount: number;
    downloadsOverTime: unknown[];
    referenceCount: number;
    citationCount: number;
    citationsOverTime: unknown[];
    partCount: number;
    partOfCount: number;
    versionCount: number;
    versionOfCount: number;
    created: string;
    registered: string;
    published: string;
    updated: string;
}

export type DataCiteResponseRelationships = {
    client: { data: DataCiteRelationshipEntry };
    provider: { data: DataCiteRelationshipEntry };
    media: { data: DataCiteRelationshipEntry };
    references: { data: DataCiteRelationshipEntry[] };
    citations: { data: DataCiteRelationshipEntry[] };
    parts: { data: DataCiteRelationshipEntry[] };
    partOf: { data: DataCiteRelationshipEntry[] };
    versions: { data: DataCiteRelationshipEntry[] };
    versionOf: { data: DataCiteRelationshipEntry[] };
}

export type DataCiteResponseData = {
    id: string;
    type: string;
    attributes: DataCiteResponseAttributes;
    relationships: DataCiteResponseRelationships;
}

export type DataCiteResponse = {
    data: DataCiteResponseData;
}

export enum DataCiteServiceStatus {
    Unavailable = 0,
    Error = 1,
    Success = 2
}

export type DataCiteServiceResult = {
    doi: string | null;
    serviceStatus: DataCiteServiceStatus;
    serviceError: string | null;
    response: DataCiteResponse | null;
}

export type DataCiteRelatedIdentifiersResult = {
    serviceStatus: DataCiteServiceStatus;
    serviceError: string | null;
    relatedIdentifiers: DataCiteRelatedIdentifier[];
}

// The DOI assignment phase holds a database transaction open across the read and write of a canonical's related
// identifiers, so a hung service must not pin a pooled connection for as long as undici's default headers timeout.
const dataCiteRequestTimeoutMs = 30_000;

export class DataCiteService {
    private static async request(method: string, urlPath: string, body?: object): Promise<DataCiteServiceResult> {
        const options = CoreServiceOptions.rest.doiGeneration;

        if (!options.prefix || !options.user || !options.password) {
            return {
                doi: null,
                serviceStatus: DataCiteServiceStatus.Unavailable,
                response: null,
                serviceError: "The DOI service is not properly configured."
            };
        }

        const url = `https://${options.host}:${options.port}${options.endpoint}${urlPath}`;

        const headers = new Headers();
        const credentials = btoa(`${options.user}:${options.password}`);

        headers.append("Content-Type", "application/json");
        headers.append("Authorization", `Basic ${credentials}`);

        const fetchOptions: RequestInit = {method, headers, signal: AbortSignal.timeout(dataCiteRequestTimeoutMs)};

        if (body !== undefined) {
            fetchOptions.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                // Read for the log only, and defensively: a rejection can carry an empty body or a proxy's HTML error
                // page, and letting response.json() throw here would reclassify a rejection as Unavailable - which the
                // DOI phase would retry under backoff forever instead of failing the child.
                let body: string;

                try {
                    body = await response.text();
                } catch {
                    body = "(unreadable)";
                }

                debug(`bad response status: ${response.status} ${body}`);

                return {
                    doi: null,
                    serviceStatus: DataCiteServiceStatus.Error,
                    response: null,
                    serviceError: response.status.toString()
                };
            }

            const result: DataCiteResponse = await response.json();

            return {
                doi: result.data.attributes.doi,
                serviceStatus: DataCiteServiceStatus.Success,
                response: result,
                serviceError: null
            };
        } catch (err) {
            debug(`exception: ${err}`);
            return {
                doi: null,
                serviceStatus: DataCiteServiceStatus.Unavailable,
                response: null,
                serviceError: err.message
            };
        }
    }

    public static async createDoi(request: DataCiteRequest): Promise<DataCiteServiceResult> {
        return this.request("POST", "", request);
    }

    // A PUT replaces relatedIdentifiers outright rather than appending, so the caller must send the whole list.  The
    // optional event lets a cross-reference update carry the promotion to findable in the same request.
    public static async updateDoi(doi: string, relatedIdentifiers: DataCiteRelatedIdentifier[], event?: string): Promise<DataCiteServiceResult> {
        const request = {
            data: {
                type: "dois",
                attributes: event ? {relatedIdentifiers, event} : {relatedIdentifiers}
            }
        };

        return this.request("PUT", `/${doi}`, request);
    }

    // Idempotent: promoting an already findable DOI changes nothing, which is what lets a retry cover a DOI that was
    // recorded locally but never promoted without tracking its DataCite state.
    public static async promoteDoi(doi: string): Promise<DataCiteServiceResult> {
        const request = {
            data: {
                type: "dois",
                attributes: {event: "publish"}
            }
        };

        return this.request("PUT", `/${doi}`, request);
    }

    public static async getDoi(doi: string): Promise<DataCiteServiceResult> {
        return this.request("GET", `/${doi}`);
    }

    public static async updateDoiUrl(doi: string, url: string): Promise<DataCiteServiceResult> {
        const request = {
            data: {
                type: "dois",
                attributes: {url}
            }
        };

        return this.request("PUT", `/${doi}`, request);
    }

    // Carries the service status: an empty list from a failed read is indistinguishable from a genuinely empty one,
    // and a caller that then PUTs [existing..., new] would replace the whole list with the single new entry.
    public static async getRelatedIdentifiers(doi: string): Promise<DataCiteRelatedIdentifiersResult> {
        const result = await this.getDoi(doi);

        return {
            serviceStatus: result.serviceStatus,
            serviceError: result.serviceError,
            relatedIdentifiers: result.response?.data?.attributes?.relatedIdentifiers ?? []
        };
    }
}
