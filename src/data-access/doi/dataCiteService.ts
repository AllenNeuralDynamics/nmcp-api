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
    event: string;
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
    relatedIdentifiers: unknown[];
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

export class DataCiteService {
    public static async createDoi(request: DataCiteRequest): Promise<DataCiteServiceResult> {
        const options = CoreServiceOptions.rest.doiGeneration;
        const url = `https://${options.host}:${options.port}${options.endpoint}`;

        debug(`calling DataCite service ${url}`);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(request)
            });

            if (!response.ok) {
                debug(`bad response status: ${response.status}`);

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
}
