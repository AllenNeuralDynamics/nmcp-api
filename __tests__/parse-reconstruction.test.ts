import {expect, test, beforeAll} from "vitest";
import {swcParse} from "../src/io/swcParser";
import * as fs from "node:fs";

import {RemoteDatabaseClient} from "../src/data-access/remoteDatabaseClient";
import {NeuronStructure} from "../src/models/neuronStructure";

let client: RemoteDatabaseClient = null;
let axonStructure: string = null;

beforeAll(async () => {
    client = await RemoteDatabaseClient.Start(false, false, true);
    axonStructure = NeuronStructure.AxonStructureId;
    console.log(`1 ${axonStructure}`);
    return client;
})

test("validates SWC parsing", async () => {

    const reconstruction = await swcParse("swc-sample.swc", fs.createReadStream("./__tests__/fixtures/swc-sample.swc"));

    expect(reconstruction.source).toBe("swc-sample.swc");

    expect(reconstruction.comments.slice(0, 6)).toBe("# DOI:")

    expect(reconstruction.axon.nodeCount).toBe(2);
    expect(reconstruction.axon.soma).toBeDefined();

    expect(reconstruction.dendrite.nodeCount).toBe(4);
    expect(reconstruction.dendrite.soma).toBeDefined();
});
