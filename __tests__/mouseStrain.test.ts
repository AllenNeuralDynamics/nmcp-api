// region - setup/teardown

import {ApolloServerTestClient} from "apollo-server-testing";
import {copyDatabase, createServerTestClient, removeDatabase} from "./testUtils";
import {gql} from "apollo-server-core";
import {Fluorophore} from "../src/models/fluorophore";
import {MouseStrain} from "../src/models/mouseStrain";

// Defined by test database.
const MOUSE_STRAIN_COUNT = 9;

const C57BL6 = "4e16d976-8529-400a-9129-f492d81d0d4c";
const SIM1_CRE = "b0ba26f5-67d0-4414-94c2-d8c807c4b9f0";
const SAMPLE_FOR_FILTER = "ffd28be1-3815-4d15-957d-8a9a6de95719";

// region Queries

describe("mouse strain api queries", () => {
    it("fetches one mouse strain", async () => {
        const res = await testClient.query({
            query: GET_MOUSE_STRAIN,
            variables: {id: C57BL6}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.mouseStrain).toBeTruthy();

        expect(res.data.mouseStrain.id).toBe(C57BL6);
        expect(res.data.mouseStrain.name).toBe("C57BL6");
    });

    it("fetches all mouse strains", async () => {
        const res = await testClient.query({query: GET_MOUSE_STRAINS});

        expect(res.data).toBeTruthy();
        expect(res.data.mouseStrains).toBeTruthy();

        expect(res.data.mouseStrains.length).toBe(MOUSE_STRAIN_COUNT);
    });

    it("fetches one page of mouse strains", async () => {
        const offset = 2;
        const limit = 10;

        const res = await testClient.query({
            query: GET_MOUSE_STRAINS,
            variables: {
                input: {
                    offset,
                    limit
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.mouseStrains).toBeTruthy();

        // Only nine mouse strains in test database.
        expect(res.data.mouseStrains.length).toBe(7);

        // Default sort order is createdAt so this is repeatable.  Validates offset.
        expect(res.data.mouseStrains[0].id).toBe("4e16d976-8529-400a-9129-f492d81d0d4c");
        expect(res.data.mouseStrains[6].id).toBe("7f4b9b3f-5fc4-444d-95df-0391b51085f5");
    });

    it("fetches mouse strains with a sample filter", async () => {
        const res = await testClient.query({
            query: GET_MOUSE_STRAINS, variables: {
                input: {
                    sampleIds: [SAMPLE_FOR_FILTER]
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.mouseStrains).toBeTruthy();

        expect(res.data.mouseStrains.length).toBe(1);
        expect(res.data.mouseStrains[0].id).toBe(SIM1_CRE);
    });
});

// endregion

// region Associations

describe("mouse strain api associations", () => {
    it("includes sample associations", async () => {
        const res = await testClient.query({
            query: GET_MOUSE_STRAIN,
            variables: {id: SIM1_CRE}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.mouseStrain).toBeTruthy();
        expect(res.data.mouseStrain.samples).toBeTruthy();
        expect(res.data.mouseStrain.samples.length).toBe(2);

        const ids = res.data.mouseStrain.samples.map(n => n.id);

        expect(ids).toContain("ffd28be1-3815-4d15-957d-8a9a6de95719");
        expect(ids).toContain("79e043dd-b49c-4b9d-8878-4ca0e5fbcbaa");
    });
});

// endregion

// region Mutations

describe("mouse strain api mutations", () => {
    it("adds a mouse strain", async () => {
        const originalCount = await MouseStrain.count({});

        let res = await testClient.mutate({
            mutation: CREATE_MOUSE_STRAIN,
            variables: {
                mouseStrain: {
                    name: "New Mouse Strain"
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.createMouseStrain).toBeTruthy();

        let mouseStrain = res.data.createMouseStrain.source;

        expect(mouseStrain).toBeTruthy();
        expect(mouseStrain.name).toBe("New Mouse Strain");

        expect(await MouseStrain.count({})).toBe(originalCount + 1);
    });

    it("updates a mouse strain", async () => {
        let res = await testClient.mutate({
            mutation: UPDATE_MOUSE_STRAIN,
            variables: {
                mouseStrain: {
                    id: "5d663143-51c8-4ff1-91e3-6fef1df6366e",
                    name: "Updated Mouse Strain"
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.updateMouseStrain).toBeTruthy();

        let injectionVirus = res.data.updateMouseStrain.source;

        expect(injectionVirus).toBeTruthy();
        expect(injectionVirus.name).toBe("Updated Mouse Strain");
    });});

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

const GET_MOUSE_STRAIN = gql`
query mouseStrain($id: String!) {
    mouseStrain(id: $id) {
        id
        name
        samples {
            id
        }
    }
}`;

const GET_MOUSE_STRAINS = gql`
query mouseStrains($input: MouseStrainQueryInput) {
    mouseStrains(input: $input) {
        id
        name
    }
}`;

const CREATE_MOUSE_STRAIN = gql`
mutation createMouseStrain($mouseStrain: MouseStrainInput) {
    createMouseStrain(mouseStrain: $mouseStrain) {
        source {
            id
            name
        }
        error
    }
}`;

const UPDATE_MOUSE_STRAIN = gql`
mutation updateMouseStrain($mouseStrain: MouseStrainInput) {
    updateMouseStrain(mouseStrain: $mouseStrain) {
        source {
            id
            name
        }
        error
    }
}`;

// endregion
