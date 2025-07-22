import {Neuron} from "../models/neuron";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Reconstruction} from "../models/reconstruction";

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
});

function sortByBestDate(r1: Reconstruction, r2: Reconstruction) {
    const date1 = r1.completedAt ?? r1.createdAt;
    const date2 = r2.completedAt ?? r2.createdAt;

    return date2.valueOf() - date1.valueOf();
}

export async function processDuplicateReconstructions(minCount: number = 2, listOnlyArg: number = 1) {
    const listOnly = listOnlyArg != 0;

    await RemoteDatabaseClient.Start(false, false);

    const duplicate = await Neuron.findWithMultipleReconstructions(minCount);

    console.log(duplicate.length);

    await duplicate.reduce(async (promise, n) => {
        await promise;

        console.log(`${n.idString}-${n.Sample.animalId} ${n.id}:`);

        n.Reconstructions.sort(sortByBestDate).forEach(r => {
            console.log(`\t${r.id} ${r.completedAt ?? r.createdAt}`);
        })

        return new Promise((resolve, reject) => {
            if (!listOnly) {
                const index = n.Reconstructions.length - 1;
                readline.question(`remove ${n.Reconstructions[index].id}?`, async (yn: string) => {
                    if (yn == "y") {
                        await Reconstruction.deleteEntry(n.Reconstructions[index].id);
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });

    }, Promise.resolve());

    readline.close();
}
