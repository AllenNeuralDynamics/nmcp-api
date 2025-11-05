import {AtlasReconstruction} from "../models/atlasReconstruction";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import * as fs from "fs";
import {User} from "../models/user";

const id = "019a8e23-3332-7250-90ce-a58eaf1bb36e";

function exportJsonData(id: string): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
        await RemoteDatabaseClient.Start(false, false);

        const data = await AtlasReconstruction.getAsJSON(User.SystemInternalUser, id);

        fs.writeFileSync("output.json", JSON.stringify(data, null, 2));
    });
}

exportJsonData(id).then((data) => {
    console.log("done");
});
