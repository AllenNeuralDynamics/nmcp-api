// region - setup/teardown

import {ApolloServerTestClient} from "apollo-server-testing";
import {copyDatabase, createServerTestClient, removeDatabase} from "./testUtils";
import {gql} from "apollo-server-core";
import {BrainArea} from "../src/models/brainArea";
import {InjectionVirus} from "../src/models/injectionVirus";

// Defined by test database.
const INJECTION_VIRUS_COUNT = 28;

const AAV2_1_FLEX_eGFP_ID = "7c792530-b1b0-47d3-b4c2-c7089523a78d";
const AAV2_1_FLEX_TVA_and_G_ID = "c8a1a350-0d89-4b36-986a-2689a7682235";
const INJECTION_FOR_FILTER = "2f473c3c-1a1e-48bb-91ca-88ac2544b37e";

// region Queries

describe("injection virus api queries", () => {
    it("fetches one injection virus", async () => {
        const res = await testClient.query({
            query: GET_INJECTION_VIRUS,
            variables: {id: AAV2_1_FLEX_eGFP_ID}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.injectionVirus).toBeTruthy();

        expect(res.data.injectionVirus.id).toBe(AAV2_1_FLEX_eGFP_ID);
        expect(res.data.injectionVirus.name).toBe("AAV2/1.FLEX-eGFP");
    });

    it("fetches all injection viruses", async () => {
        const res = await testClient.query({query: GET_INJECTION_VIRUSES});

        expect(res.data).toBeTruthy();
        expect(res.data.injectionViruses).toBeTruthy();

        expect(res.data.injectionViruses.length).toBe(INJECTION_VIRUS_COUNT);
    });

    it("fetches one page of injection viruses", async () => {
        const offset = 2;
        const limit = 10;

        const res = await testClient.query({
            query: GET_INJECTION_VIRUSES,
            variables: {
                input: {
                    offset,
                    limit
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.injectionViruses).toBeTruthy();

        expect(res.data.injectionViruses.length).toBe(limit);

        // Default sort order is createdAt so this is repeatable.  Validates offset.
        expect(res.data.injectionViruses[0].id).toBe("67ea14d6-d2d5-4d88-8f3d-7dba0a376baa");
        expect(res.data.injectionViruses[9].id).toBe("d4239b18-2932-4967-8a9b-2532aad14efd");
    });

    it("fetches injection viruses with an injection filter", async () => {
        const res = await testClient.query({
            query: GET_INJECTION_VIRUSES, variables: {
                input: {
                    injectionIds: [INJECTION_FOR_FILTER]
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.injectionViruses).toBeTruthy();

        expect(res.data.injectionViruses.length).toBe(1);
        expect(res.data.injectionViruses[0].id).toBe(AAV2_1_FLEX_TVA_and_G_ID);
    });
});

// endregion

// region Associations

describe("injection virus api associations", () => {
    it("includes injection associations", async () => {
        const res = await testClient.query({
            query: GET_INJECTION_VIRUS,
            variables: {id: AAV2_1_FLEX_TVA_and_G_ID}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.injectionVirus).toBeTruthy();
        expect(res.data.injectionVirus.injections).toBeTruthy();
        expect(res.data.injectionVirus.injections.length).toBe(3);

        const ids = res.data.injectionVirus.injections.map(n => n.id);

        expect(ids).toContain("2f473c3c-1a1e-48bb-91ca-88ac2544b37e");
        expect(ids).toContain("b9638f5a-bf21-449a-844d-ecf717a780a7");
        expect(ids).toContain("22d204ed-94d0-4baf-8859-9bf15390fb64");
    });
});

// endregion

// region Mutations

describe("injection virus api mutations", () => {
    it("adds an injection virus", async () => {
        const originalCount = await InjectionVirus.count({});

        let res = await testClient.mutate({
            mutation: CREATE_INJECTION_VIRUS,
            variables: {
                injectionVirus: {
                    name: "New Injection Virus"
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.createInjectionVirus).toBeTruthy();

        let injectionVirus = res.data.createInjectionVirus.source;

        expect(injectionVirus).toBeTruthy();
        expect(injectionVirus.name).toBe("New Injection Virus");

        expect(await InjectionVirus.count({})).toBe(originalCount + 1);
    });

    it("updates an injection virus", async () => {
        let res = await testClient.mutate({
            mutation: UPDATE_INJECTION_VIRUS,
            variables: {
                injectionVirus: {
                    id: "89b4f576-3e28-46e5-8b48-ee0d8e59d3b1",
                    name: "Updated Injection Virus"
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.updateInjectionVirus).toBeTruthy();

        let injectionVirus = res.data.updateInjectionVirus.source;

        expect(injectionVirus).toBeTruthy();
        expect(injectionVirus.name).toBe("Updated Injection Virus");
    });
});

// endregion

let tempDatabaseName = "";

// endregion

let testClient: ApolloServerTestClient = null;

beforeAll(async () => {
    tempDatabaseName = await copyDatabase();

    testClient = createServerTestClient();
});

afterAll(() => {
    removeDatabase(tempDatabaseName);
});

// region - test queries

const GET_INJECTION_VIRUS = gql`
query injectionVirus($id: String!) {
    injectionVirus(id: $id) {
        id
        name
        injections {
            id
        }
    }
}`;

const GET_INJECTION_VIRUSES = gql`
query injectionViruses($input: InjectionVirusQueryInput) {
    injectionViruses(input: $input) {
        id
        name
    }
}`;

const CREATE_INJECTION_VIRUS = gql`
mutation createInjectionVirus($injectionVirus: InjectionVirusInput) {
    createInjectionVirus(injectionVirus: $injectionVirus) {
        source {
            id
            name
        }
        error
    }
}`;

const UPDATE_INJECTION_VIRUS = gql`
mutation updateInjectionVirus($injectionVirus: InjectionVirusInput) {
    updateInjectionVirus(injectionVirus: $injectionVirus) {
        source {
            id
            name
        }
        error
    }
}`;

// endregion