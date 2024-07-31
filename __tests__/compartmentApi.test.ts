import {gql} from "apollo-server";
import {ApolloServerTestClient} from "apollo-server-testing";

import {copyDatabase, removeDatabase, createServerTestClient} from "./testUtils";
import {BrainArea} from "../src/models/brainArea";

// Defined by test database.
const BRAIN_AREA_COUNT = 1287;

const WHOLE_BRAIN = "464cb1ee-4664-40dc-948f-85dd1feb3e40";
const POSTSUBICULUM = "e4e6bf0b-3646-4346-a85a-ac66c8417ad7";
const VENTRAL_GROUP_DORSAL_THALAMUS = "ad194723-1608-4241-9b29-b125020fd588";

const NEURON_FOR_FILTER = "7c379c17-7102-4c21-a70a-def11bb5814c";
const INJECTION_FOR_FILTER = "dbbfe1f4-9cf4-49bc-bef9-d105bbf2534b";

// region Queries

describe("compartment api queries", () => {
    it("fetches one compartment", async () => {
        const res = await testClient.query({
            query: GET_COMPARTMENT,
            variables: {id: POSTSUBICULUM}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.brainArea).toBeTruthy();

        expect(res.data.brainArea.id).toBe(POSTSUBICULUM);
        expect(res.data.brainArea.name).toBe("Postsubiculum");
        expect(res.data.brainArea.safeName).toBe("Postsubiculum");
        expect(res.data.brainArea.acronym).toBe("POST");
    });

    it("fetches all compartments", async () => {
        const res = await testClient.query({query: GET_COMPARTMENTS});

        expect(res.data).toBeTruthy();
        expect(res.data.brainAreas).toBeTruthy();

        expect(res.data.brainAreas.length).toBe(BRAIN_AREA_COUNT);
    });

    it("fetches one page of compartments", async () => {
        const offset = 100;
        const limit = 10;

        const res = await testClient.query({
            query: GET_COMPARTMENTS,
            variables: {
                input: {
                    offset,
                    limit
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.brainAreas).toBeTruthy();

        expect(res.data.brainAreas.length).toBe(limit);

        // Default sort order is depth so this is repeatable.  Validates offset.
        expect(res.data.brainAreas[0].id).toBe("3f9529d0-f85d-4f3b-81a6-bd33a93abb26");
        expect(res.data.brainAreas[9].id).toBe("c224c481-edf1-43b0-8841-54fc63c0c600");
    });

    it("fetches compartments with a neuron filter", async () => {
        const res = await testClient.query({
            query: GET_COMPARTMENTS, variables: {
                input: {
                    neuronIds: [NEURON_FOR_FILTER]
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.brainAreas).toBeTruthy();

        expect(res.data.brainAreas.length).toBe(1);
        expect(res.data.brainAreas[0].id).toBe(POSTSUBICULUM);
    });

    it("fetches compartments with an injection filter", async () => {
        const res = await testClient.query({
            query: GET_COMPARTMENTS, variables: {
                input: {
                    injectionIds: [INJECTION_FOR_FILTER]
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.brainAreas).toBeTruthy();

        expect(res.data.brainAreas.length).toBe(1);
        expect(res.data.brainAreas[0].id).toBe(VENTRAL_GROUP_DORSAL_THALAMUS);
    });
});

// endregion

// region Associations

describe("compartment api associations", () => {
    it("includes neuron associations", async () => {
        const res = await testClient.query({
            query: GET_COMPARTMENT,
            variables: {id: POSTSUBICULUM}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.brainArea).toBeTruthy();
        expect(res.data.brainArea.neurons).toBeTruthy();
        expect(res.data.brainArea.neurons.length).toBe(5);

        const ids = res.data.brainArea.neurons.map(n => n.id);

        expect(ids).toContain("7c379c17-7102-4c21-a70a-def11bb5814c");
        expect(ids).toContain("8aa9962e-3f1f-4985-80b0-883500de64e3");
        expect(ids).toContain("51d8c820-9ca9-4c21-96f1-af1e200a4b08");
        expect(ids).toContain("131ad5f1-736e-42c4-bbfd-98cadbe6d96e");
        expect(ids).toContain("fa3a6026-515f-4167-94cb-fc9d28ce7404");
    });

    it("includes injection associations", async () => {
        const res = await testClient.query({
            query: GET_COMPARTMENT,
            variables: {id: "ad194723-1608-4241-9b29-b125020fd588"}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.brainArea).toBeTruthy();
        expect(res.data.brainArea.injections).toBeTruthy();
        expect(res.data.brainArea.injections.length).toBe(3);

        const ids = res.data.brainArea.injections.map(i => i.id);

        expect(ids).toContain("dbbfe1f4-9cf4-49bc-bef9-d105bbf2534b");
        expect(ids).toContain("269af31d-43c8-493e-b70c-1874d982d730");
        expect(ids).toContain("a9008cc1-fd1d-4e40-b031-f63dcb71ae14");
    });
});

// endregion

// region - setup/teardown

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

const GET_COMPARTMENT = gql`
query brainArea($id: String!) {
    brainArea(id: $id) {
        id
        name
        safeName
        acronym
        neurons {
            id
            idNumber
        }
        injections {
            id
        }
    }
}`;

const GET_COMPARTMENTS = gql`
query brainAreas($input: BrainAreaQueryInput) {
    brainAreas(input: $input) {
        id
        name
        safeName
        acronym
    }
}`;

// endregion
