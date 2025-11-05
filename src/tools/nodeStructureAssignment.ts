import {AtlasReconstruction} from "../models/atlasReconstruction";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {User} from "../models/user";
import {Precomputed} from "../models/precomputed";

const id = "019a9212-17a8-7cb3-a7aa-a507a427d914";

function getPendingPrecomputed() {
    return new Promise(async (resolve, reject) => {
        await RemoteDatabaseClient.Start(false, false);

        console.log(await Precomputed.getPending(User.SystemInternalUser));
    });
}

function nodeStructureAssignment(id: string): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
        await RemoteDatabaseClient.Start(false, false);

        const data = await AtlasReconstruction.findByPk(id);

        await data.calculateStructureAssignments(User.SystemAutomationUser);
    });
}


nodeStructureAssignment(id).then((data) => {
    console.log("done");
});


/*
getPendingPrecomputed().then(() => {
    console.log("done");
});
*/
