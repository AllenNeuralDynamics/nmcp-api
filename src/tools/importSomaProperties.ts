import * as fs from "fs";
import * as path from "path";

import {parseSomaPropertyFile} from "../util/somaPropertyParser";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Sample} from "../models/sample";
import {Neuron} from "../models/neuron";
import {BrainArea} from "../models/brainArea";

const debug = require("debug")("nmcp:api:tools:importSomaProperties");

export async function importSomaProperties(filename: string, subjectId: string = null, noEmit: boolean = true) {
    await RemoteDatabaseClient.Start(false, false);

    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        throw new Error(`File not found: ${filename}`);
    }

    if (!subjectId) {
        const basename = path.basename(filename, '.csv');
        const match = basename.match(/^.*-(.+)$/);
        
        if (match && match[1]) {
            subjectId = match[1];
        } else {
            throw new Error(`Unable to extract subjectId from filename: ${filename}. Expected pattern: sometext-subjectid.csv`);
        }
    }

    await BrainArea.loadCompartmentCache();

    const sample = await Sample.findOne({ where: { animalId: subjectId } });

    if (!sample) {
        throw new Error(`No sample found with animalId: ${subjectId}`);
    }

    const processedRecords = await parseSomaPropertyFile(filename);

    const nextNumber = await Neuron.findNextAvailableIdNumber(sample.id);

    debug(`Starting neuron labelling from base index ${nextNumber}`);

    // console.log(processedRecords);

    const idStrings = await Neuron.insertSomaEntries(processedRecords, sample, nextNumber, noEmit);

    debug(`Created ${processedRecords.length} neurons for sample ${sample.animalId} (${sample.id})`);

    debug(`First ids: ${idStrings.slice(0, 5).join(", ")}`);
}
