// region - setup/teardown

import {ApolloServerTestClient} from "apollo-server-testing";
import {copyDatabase, createServerTestClient, removeDatabase} from "./testUtils";
import {gql} from "apollo-server-core";
import {Fluorophore} from "../src/models/fluorophore";

// Defined by test database.
const FLUOROPHORE_COUNT = 11;

const eGFP_ID = "47fc1eff-a7e0-4a56-9e4d-5797f8d28d5f";
const immuno_labeled_for_anti_tDT = "13cf7b2b-3580-4c79-8e35-e2d49fa5b208";
const INJECTION_FOR_FILTER = "4ab633d2-8cbd-4a6b-96db-ec1ab3d2751f";

// region Queries

describe("fluorophore api queries", () => {
    it("fetches one fluorophore", async () => {
        const res = await testClient.query({
            query: GET_FLUOROPHORE,
            variables: {id: eGFP_ID}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.fluorophore).toBeTruthy();

        expect(res.data.fluorophore.id).toBe(eGFP_ID);
        expect(res.data.fluorophore.name).toBe("eGFP");
    });

    it("fetches all injection viruses", async () => {
        const res = await testClient.query({query: GET_FLUOROPHORES});

        expect(res.data).toBeTruthy();
        expect(res.data.fluorophores).toBeTruthy();

        expect(res.data.fluorophores.length).toBe(FLUOROPHORE_COUNT);
    });

    it("fetches one page of fluorophores", async () => {
        const offset = 1;
        const limit = 10;

        const res = await testClient.query({
            query: GET_FLUOROPHORES,
            variables: {
                input: {
                    offset,
                    limit
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.fluorophores).toBeTruthy();

        expect(res.data.fluorophores.length).toBe(limit);

        // Default sort order is createdAt so this is repeatable.  Validates offset.
        expect(res.data.fluorophores[0].id).toBe("48fd3c4e-d0ad-4ef7-8a6d-b62248930ddf");
        expect(res.data.fluorophores[9].id).toBe("c5d9184f-4d25-40a7-bf1f-e396876e7743");
    });

    it("fetches fluorophores with an injection filter", async () => {
        const res = await testClient.query({
            query: GET_FLUOROPHORES, variables: {
                input: {
                    injectionIds: [INJECTION_FOR_FILTER]
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.fluorophores).toBeTruthy();

        expect(res.data.fluorophores.length).toBe(1);
        expect(res.data.fluorophores[0].id).toBe(immuno_labeled_for_anti_tDT);
    });
});

// endregion

// region Associations

describe("fluorophore api associations", () => {
    it("includes injection associations", async () => {
        const res = await testClient.query({
            query: GET_FLUOROPHORE,
            variables: {id: immuno_labeled_for_anti_tDT}
        });

        expect(res.data).toBeTruthy();
        expect(res.data.fluorophore).toBeTruthy();
        expect(res.data.fluorophore.injections).toBeTruthy();
        expect(res.data.fluorophore.injections.length).toBe(3);

        const ids = res.data.fluorophore.injections.map(n => n.id);

        expect(ids).toContain("4ab633d2-8cbd-4a6b-96db-ec1ab3d2751f");
        expect(ids).toContain("bbca6af2-1fc2-4f17-866e-dd291e66224e");
        expect(ids).toContain("3009da3f-9b16-48db-8319-3db4af7504d8");
    });
});

// endregion

// region Mutations

describe("fluorophore api mutations", () => {
    it("adds a fluorophore", async () => {
        const originalCount = await Fluorophore.count({});

        let res = await testClient.mutate({
            mutation: CREATE_FLUOROPHORE,
            variables: {
                fluorophore: {
                    name: "New Fluorophore"
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.createFluorophore).toBeTruthy();

        let fluorophore = res.data.createFluorophore.source;

        expect(fluorophore).toBeTruthy();
        expect(fluorophore.name).toBe("New Fluorophore");

        expect(await Fluorophore.count({})).toBe(originalCount + 1);
    });

    it("updates a fluorophore", async () => {
        let res = await testClient.mutate({
            mutation: UPDATE_FLUOROPHORE,
            variables: {
                fluorophore: {
                    id: "a70e3352-64bf-4285-9d25-09c823655866",
                    name: "Updated Fluorophore"
                }
            }
        });

        expect(res.data).toBeTruthy();
        expect(res.data.updateFluorophore).toBeTruthy();

        let injectionVirus = res.data.updateFluorophore.source;

        expect(injectionVirus).toBeTruthy();
        expect(injectionVirus.name).toBe("Updated Fluorophore");
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

const GET_FLUOROPHORE = gql`
query fluorophore($id: String!) {
    fluorophore(id: $id) {
        id
        name
        injections {
            id
        }
    }
}`;

const GET_FLUOROPHORES = gql`
query fluorophores($input: FluorophoreQueryInput) {
    fluorophores(input: $input) {
        id
        name
    }
}`;

const CREATE_FLUOROPHORE = gql`
mutation createFluorophore($fluorophore: FluorophoreInput) {
    createFluorophore(fluorophore: $fluorophore) {
        source {
            id
            name
        }
        error
    }
}`;

const UPDATE_FLUOROPHORE = gql`
mutation updateFluorophore($fluorophore: FluorophoreInput) {
    updateFluorophore(fluorophore: $fluorophore) {
        source {
            id
            name
        }
        error
    }
}`;

// endregion
