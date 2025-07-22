import * as fs from "fs";
import * as path from "path";

import {parseSomaPropertyData} from "../util/somaPropertyParser";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Sample} from "../models/sample";
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
            throw new Error(`Unable to extract subjectId from filename: ${filename}. Expected pattern: sometext-subjectid.csv`);
        }
    }

    const sample = await Sample.findOne({ where: { animalId: subjectId } });

    if (!sample) {
        throw new Error(`No sample found with animalId: ${subjectId}`);
    }

    const processedRecords = await parseSomaPropertyData(filename);

    const existingNeurons = await Neuron.findAll({
        where: { sampleId: sample.id },
        attributes: ['idString'],
        order: [['idString', 'DESC']]
    });

    let nextNumber = 1;

    if (existingNeurons.length > 0) {
        const existingNumbers = existingNeurons
            .map(n => n.idString)
            .filter(idString => /^N\d{3,}$/.test(idString))
            .map(idString => parseInt(idString.substring(1)))
            .filter(num => !isNaN(num));
        
        if (existingNumbers.length > 0) {
            nextNumber = Math.max(...existingNumbers) + 1;
        }
    }
    debug(`Starting neuron labelling from base index ${nextNumber}`);

    console.log(processedRecords);

    if (!noEmit) {
        for (let i = 0; i < processedRecords.length; i++) {
            const record = processedRecords[i];
            const idString = `N${String(nextNumber + i).padStart(3, '0')}`;

            const neuron = await Neuron.create({
                sampleId: sample.id,
                idString: idString,
                x: record.xyz?.x || 0,
                y: record.xyz?.y || 0,
                z: record.xyz?.z || 0,
                somaProperties: record
            });
        }

        debug(`Created ${processedRecords.length} neurons for sample ${sample.id}`);
    } else {
        debug(`Skipping database update (noEmit is true).`);
    }
}
