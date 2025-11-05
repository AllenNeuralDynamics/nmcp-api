import * as fs from "fs";
import * as path from "path";

import {parseSomaPropertyFile} from "../io/somaPropertyParser";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Specimen} from "../models/specimen";
import {Neuron} from "../models/neuron";

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
            throw new Error(`Unable to extract specimen id from filename: ${filename}. Expected pattern: (any-text)-specimenId.csv`);
        }
    }

    const specimen = await Specimen.findOne({ where: { animalId: subjectId } });

    if (!specimen) {
        throw new Error(`No specimen found with animalId: ${subjectId}`);
    }

    const processedRecords = await parseSomaPropertyFile(filename, specimen.getAtlas());

    const nextNumber = await Neuron.findNextAvailableIdString(specimen.id);

    debug(`Starting neuron labelling from base index ${nextNumber}`);

    const idStrings = await Neuron.insertSomaEntries(processedRecords, specimen, nextNumber, noEmit);

    debug(`Created ${processedRecords.length} neurons for specimen ${specimen.label} (${specimen.id})`);

    debug(`First ids: ${idStrings.slice(0, 5).join(", ")}`);
}
