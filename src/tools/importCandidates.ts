import * as fs from "fs";
import * as path from "path";

import {parseSomaPropertySteam} from "../io/somaPropertyParser";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {CandidateImportOptions, Specimen} from "../models/specimen";
import {Neuron} from "../models/neuron";
import {User} from "../models/user";

const debug = require("debug")("nmcp:api:tools:importSomaProperties");

export async function importCandidates(filename: string, specimenLabel: string = null): Promise<number> {
    return new Promise<number>(async (resolve) => {
        await RemoteDatabaseClient.Start(false, false);

        if (!specimenLabel) {
            const basename = path.basename(filename, '.csv');
            const match = basename.match(/^.*-(.+)$/);

            if (match && match[1]) {
                specimenLabel = match[1];
            } else {
                throw new Error(`Unable to extract specimen label from filename: ${filename}. Expected pattern: (any-text)-specimenLabel.csv`);
            }
        }

        const specimen = await Specimen.findOne({where: {label: specimenLabel}});

        if (!specimen) {
            throw new Error(`No specimen found with label: ${specimenLabel}`);
        }

        const options: CandidateImportOptions = {
            source: filename,
            specimenId: specimen.id,
            keywords: [],
            shouldLookupSoma: true,
            defaultBrightness: null,
            defaultVolume: null
        }
        const count = await Specimen.importCandidates(User.SystemAutomationUser, fs.createReadStream(filename), options);

        debug(`created ${count} neurons for specimen ${specimen.label} (${specimen.id})`);

        resolve(count);
    });
}

if (process.argv.length < 3) {
    console.error("Soma candidates file required");
    process.exit(-1);
}

const sourceFile: string = process.argv[2];

if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    console.error(`${sourceFile} is not a readable candidates file.`);
    process.exit(-1);
}

const start = performance.now();

importCandidates(sourceFile).then((count) => debug(`importCandidates: ${((performance.now() - start)/1000).toFixed(3)}s`));
