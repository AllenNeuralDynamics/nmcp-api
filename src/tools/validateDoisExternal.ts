import {Op} from "sequelize";

import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {Reconstruction} from "../models/reconstruction";
import {Neuron} from "../models/neuron";
import {SearchIndex} from "../models/searchIndex";
import {DataCiteService, DataCiteRelatedIdentifier, DataCiteServiceStatus} from "../data-access/doi/dataCiteService";

const debug = require("debug")("nmcp:api:tools:fix-doi-urls");

const nonEmptyDoi = {[Op.and]: [{[Op.not]: null}, {[Op.ne]: ""}]};

const doubleSlashPattern = /\/\/neuron\//;

async function fixDoiUrls(): Promise<void> {
    const reconstructions = await AtlasReconstruction.findAll({
        where: {doi: nonEmptyDoi},
        attributes: ["id", "doi"]
    });

    debug(`Found ${reconstructions.length} reconstructions with DOIs`);

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

        debug(`DOI ${doi}: ${currentUrl} -> ${fixedUrl}`);

        const updateResult = await DataCiteService.updateDoiUrl(doi, fixedUrl);

        if (updateResult.serviceStatus !== DataCiteServiceStatus.Success) {
            debug(`Failed to update DOI ${doi}: ${updateResult.serviceError}`);
            errorCount++;
            continue;
        }

        updatedCount++;
    }

    debug(`Complete: ${checkedCount} checked, ${updatedCount} updated, ${errorCount} errors`);
}

function hasRelatedIdentifier(existing: DataCiteRelatedIdentifier[], relationType: string, targetDoi: string): boolean {
    return existing.some(ri => ri.relationType === relationType && ri.relatedIdentifier === targetDoi);
}

async function ensureReconstructionIsVersionOf(): Promise<void> {
    const reconstructions = await AtlasReconstruction.findAll({
        where: {doi: nonEmptyDoi},
        include: [{
            model: Reconstruction,
            include: [{
                model: Neuron,
                where: {canonicalDoi: nonEmptyDoi}
            }]
        }]
    });

    debug(`Found ${reconstructions.length} reconstruction DOIs with associated neuron canonical DOIs`);

    let checkedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const atlasReconstruction of reconstructions) {
        const reconstructionDoi = atlasReconstruction.doi;
        const neuronDoi = atlasReconstruction.Reconstruction?.Neuron?.canonicalDoi;

        if (!neuronDoi) {
            continue;
        }

        const existing = await DataCiteService.getRelatedIdentifiers(reconstructionDoi);

        checkedCount++;

        if (hasRelatedIdentifier(existing, "IsVersionOf", neuronDoi)) {
            continue;
        }

        debug(`Reconstruction DOI ${reconstructionDoi}: adding IsVersionOf -> ${neuronDoi}`);

        const updateResult = await DataCiteService.updateDoi(reconstructionDoi, [
            ...existing,
            {relatedIdentifierType: "DOI", relationType: "IsVersionOf", relatedIdentifier: neuronDoi, resourceTypeGeneral: "Dataset"}
        ]);

        if (updateResult.serviceStatus !== DataCiteServiceStatus.Success) {
            debug(`Failed to update DOI ${reconstructionDoi}: ${updateResult.serviceError}`);
            errorCount++;
            continue;
        }

        updatedCount++;
    }

    debug(`Complete: ${checkedCount} checked, ${updatedCount} updated, ${errorCount} errors`);
}

async function ensureNeuronHasVersion(): Promise<void> {
    const neurons = await Neuron.findAll({
        where: {canonicalDoi: nonEmptyDoi},
        attributes: ["id", "canonicalDoi"],
        include: [{
            model: Reconstruction,
            as: "SpecimenReconstruction",
            include: [{
                model: AtlasReconstruction,
                where: {doi: nonEmptyDoi}
            }]
        }]
    });

    debug(`Found ${neurons.length} neuron canonical DOIs with associated reconstruction DOIs`);

    let checkedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const neuron of neurons) {
        const neuronDoi = neuron.canonicalDoi;
        const reconstructions = (neuron as any).SpecimenReconstruction ?? [];

        const existing = await DataCiteService.getRelatedIdentifiers(neuronDoi);

        checkedCount++;

        const missing: DataCiteRelatedIdentifier[] = [];

        for (const reconstruction of reconstructions) {
            const reconstructionDoi = reconstruction.AtlasReconstruction?.doi;

            if (!reconstructionDoi) {
                continue;
            }

            if (!hasRelatedIdentifier(existing, "HasVersion", reconstructionDoi)) {
                debug(`Neuron DOI ${neuronDoi}: adding HasVersion -> ${reconstructionDoi}`);
                missing.push({relatedIdentifierType: "DOI", relationType: "HasVersion", relatedIdentifier: reconstructionDoi, resourceTypeGeneral: "Dataset"});
            }
        }

        if (missing.length === 0) {
            continue;
        }

        const updateResult = await DataCiteService.updateDoi(neuronDoi, [...existing, ...missing]);

        if (updateResult.serviceStatus !== DataCiteServiceStatus.Success) {
            debug(`Failed to update DOI ${neuronDoi}: ${updateResult.serviceError}`);
            errorCount++;
            continue;
        }

        updatedCount++;
    }

    debug(`Complete: ${checkedCount} checked, ${updatedCount} updated, ${errorCount} errors`);
}

async function updateSearchIndexCanonicalDois(): Promise<void> {
    const neurons = await Neuron.findAll({
        where: {canonicalDoi: nonEmptyDoi},
        attributes: ["id", "canonicalDoi"]
    });

    debug(`Found ${neurons.length} neurons with canonical DOIs`);

    let updatedCount = 0;

    for (const neuron of neurons) {
        const [affectedCount] = await SearchIndex.update(
            {canonicalDoi: neuron.canonicalDoi},
            {where: {neuronId: neuron.id}}
        );

        if (affectedCount > 0) {
            debug(`Updated ${affectedCount} SearchIndex rows for neuron ${neuron.id} with canonical DOI ${neuron.canonicalDoi}`);
            updatedCount += affectedCount;
        }
    }

    debug(`Complete: ${updatedCount} SearchIndex rows updated`);
}

async function run(): Promise<void> {
    await RemoteDatabaseClient.Start(false, false);

    debug("\n--- Fix DOI URLs ---");
    // await fixDoiUrls();

    debug("\n--- Ensure Reconstruction DOIs have IsVersionOf -> Neuron DOI ---");
    // await ensureReconstructionIsVersionOf();

    debug("\n--- Ensure Neuron DOIs have HasVersion -> Reconstruction DOI ---");
    // await ensureNeuronHasVersion();

    debug("\n--- Update SearchIndex canonical DOIs from Neurons ---");
    await updateSearchIndexCanonicalDois();
}

run()
    .then(() => process.exit(0))
    .catch((err) => {
        debug(err);
        process.exit(1);
    });
