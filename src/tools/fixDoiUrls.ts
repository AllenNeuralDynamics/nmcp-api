import {Op} from "sequelize";

import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {DataCiteService, DataCiteServiceStatus} from "../data-access/doi/dataCiteService";

const debug = require("debug")("nmcp:api:tools:fix-doi-urls");

const doubleSlashPattern = /\/\/neuron\//;

async function fixDoiUrls(): Promise<void> {
    await RemoteDatabaseClient.Start(false, false);

    const reconstructions = await AtlasReconstruction.findAll({
        where: {doi: {[Op.and]: [{[Op.not]: null}, {[Op.ne]: ""}]}},
        attributes: ["id", "doi"]
    });

    console.log(`Found ${reconstructions.length} reconstructions with DOIs`);

    let checkedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const reconstruction of reconstructions) {
        const doi = reconstruction.doi;

        const result = await DataCiteService.getDoi(doi);

        if (result.serviceStatus !== DataCiteServiceStatus.Success) {
            debug(`Failed to retrieve DOI ${doi}: ${result.serviceError}`);
            errorCount++;
            continue;
        }

        checkedCount++;

        const currentUrl = result.response?.data?.attributes?.url;

        if (!currentUrl || !doubleSlashPattern.test(currentUrl)) {
            continue;
        }

        const fixedUrl = currentUrl.replace(doubleSlashPattern, "/neuron/");

        console.log(`DOI ${doi}: ${currentUrl} -> ${fixedUrl}`);

        const updateResult = await DataCiteService.updateDoiUrl(doi, fixedUrl);

        if (updateResult.serviceStatus !== DataCiteServiceStatus.Success) {
            debug(`Failed to update DOI ${doi}: ${updateResult.serviceError}`);
            errorCount++;
            continue;
        }

        updatedCount++;
    }

    console.log(`Complete: ${checkedCount} checked, ${updatedCount} updated, ${errorCount} errors`);
}

fixDoiUrls()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
