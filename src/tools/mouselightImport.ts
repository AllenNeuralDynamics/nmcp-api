import * as fs from "fs";
import * as path from "path";

import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Collection} from "../models/collection";
import {Injection, InjectionShape} from "../models/injection";
import {Neuron, NeuronShape} from "../models/neuron";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionSpace} from "../models/reconstructionSpace";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {Specimen, SpecimenShape} from "../models/specimen";
import {User} from "../models/user";
import {normalizeKeywords} from "../util/keywords";

const debug = require("debug")("nmcp:api:mouselight");

const skipReconstructions = false;

type MlSample = {
    id: string;
    idNumber: number;
};

type MlBrainArea = {
    id: string;
    structureId: number;
    name: string;
    acronym: string;
};

type MlNeuron = {
    id: string;
    idString: string;
    keywords?: string;
    brainArea?: MlBrainArea;
    sample?: MlSample;
};

type MlNode = {
    x: number;
    y: number;
    z: number;
    radius?: number;
    allenId?: number;
};

type MlExportJson = {
    neurons: MlExportNeuron[];
};

type MlExportNeuron = {
    idString: string;
    DOI?: string;
    sample?: {
        date?: string;
        strain?: string;
    };
    label?: {
        virus?: string;
        fluorophore?: string;
    };
    soma?: MlNode;
    axon?: unknown;
    dendrite?: unknown;
};

type MouseLightImportConfig = {
    host: string;
    port?: string;
    cacheDir: string;
    resetCache: boolean;
    specimenIdNumber?: number;
};

type EnrichedNeuron = {
    mlNeuron: MlNeuron;
    exportNeuron: MlExportNeuron;
};

type SampleGroup = {
    sample: MlSample;
    items: EnrichedNeuron[];
};

const neuronsQuery = `{
  neurons {
    id
    idString
    keywords
    brainArea {
      id
      structureId
      name
      acronym
    }
    sample {
      id
      idNumber
    }
  }
}`;

const immutableReconstructionStatus = [ReconstructionStatus.Published, ReconstructionStatus.Archived, ReconstructionStatus.Discarded];

function buildBaseUrl(host: string, port?: string): string {
    return port ? `${host}:${port}` : host;
}

async function queryMouseLight<T>(baseUrl: string, query: string): Promise<T> {
    const response = await fetch(`${baseUrl}/graphql`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({query})
    });

    if (!response.ok) {
        throw new Error(`GraphQL HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();

    if (result.errors?.length) {
        throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
    }

    return result.data as T;
}

async function ensureExportFile(baseUrl: string, cacheDir: string, idString: string, format: 0 | 1, resetCache: boolean): Promise<string> {
    const extension = format === 0 ? "swc" : "json";
    const filePath = path.join(cacheDir, `${idString}.${extension}`);

    if (!resetCache && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        debug(`cache hit: ${filePath}`);
        return filePath;
    }

    debug(`downloading ${idString}.${extension} from ${baseUrl}/export`);

    await fs.promises.mkdir(cacheDir, {recursive: true});

    const response = await fetch(`${baseUrl}/export`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            ids: [idString],
            ccfVersion: 1,
            format
        })
    });

    if (!response.ok) {
        throw new Error(`export ${idString}.${extension} HTTP ${response.status}: ${await response.text()}`);
    }

    const wrapper = await response.json();

    if (wrapper.contents == null) {
        throw new Error(`export ${idString}.${extension}: response has no "contents" property (keys: ${Object.keys(wrapper).join(", ")})`);
    }

    if (format === 0) {
        const decoded = Buffer.from(wrapper.contents, "base64");
        await fs.promises.writeFile(filePath, decoded);
    } else {
        await fs.promises.writeFile(filePath, JSON.stringify(wrapper.contents));
    }

    return filePath;
}

async function ensureSwcFile(baseUrl: string, cacheDir: string, idString: string, resetCache: boolean): Promise<string> {
    return ensureExportFile(baseUrl, cacheDir, idString, 0, resetCache);
}

async function ensureJsonFile(baseUrl: string, cacheDir: string, idString: string, resetCache: boolean): Promise<string> {
    return ensureExportFile(baseUrl, cacheDir, idString, 1, resetCache);
}

async function readExportNeuron(jsonPath: string, idString: string): Promise<MlExportNeuron> {
    const content = await fs.promises.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(content);

    const inner = parsed.contents ?? parsed;
    const neurons: MlExportNeuron[] | undefined = inner.neurons;

    if (!Array.isArray(neurons)) {
        const topLevelKeys = Object.keys(parsed);
        const innerKeys = parsed.contents ? Object.keys(parsed.contents) : [];
        debug(`unexpected JSON structure in ${jsonPath}: top-level keys=[${topLevelKeys.join(", ")}], contents keys=[${innerKeys.join(", ")}]`);
        debug(`first 200 chars: ${content.slice(0, 200)}`);
        throw new Error(`JSON export at ${jsonPath} has no "neurons" array`);
    }

    const exportNeuron = neurons.find(neuron => neuron.idString === idString);

    if (!exportNeuron) {
        const available = neurons.map(neuron => neuron.idString).join(", ");
        throw new Error(`JSON export at ${jsonPath} does not contain neuron ${idString} (available: ${available})`);
    }

    return exportNeuron;
}

function groupBySample(enriched: EnrichedNeuron[]): Map<number, SampleGroup> {
    const bySample = new Map<number, SampleGroup>();

    for (const item of enriched) {
        const sampleIdNumber = item.mlNeuron.sample?.idNumber;

        if (sampleIdNumber == null) {
            debug(`neuron ${item.mlNeuron.idString} has no sample, skipping`);
            continue;
        }

        if (!bySample.has(sampleIdNumber)) {
            bySample.set(sampleIdNumber, {
                sample: item.mlNeuron.sample,
                items: []
            });
        }

        bySample.get(sampleIdNumber).items.push(item);
    }

    return bySample;
}

type SpecimenMetadata = {
    referenceDate?: Date;
    genotypeName?: string;
};

function chooseSpecimenMetadata(exportNeurons: MlExportNeuron[]): SpecimenMetadata {
    let referenceDate: Date | undefined;
    let genotypeName: string | undefined;
    let referenceDateSource: string | undefined;
    let genotypeSource: string | undefined;

    for (const exportNeuron of exportNeurons) {
        const dateStr = exportNeuron.sample?.date;
        if (dateStr && !referenceDate) {
            referenceDate = new Date(dateStr);
            referenceDateSource = exportNeuron.idString;
        } else if (dateStr && referenceDate) {
            const candidate = new Date(dateStr);
            if (candidate.getTime() !== referenceDate.getTime()) {
                debug(`conflict: specimen date from ${exportNeuron.idString} (${dateStr}) differs from ${referenceDateSource}; keeping first value`);
            }
        }

        const strain = exportNeuron.sample?.strain?.trim();
        if (strain && !genotypeName) {
            genotypeName = strain;
            genotypeSource = exportNeuron.idString;
        } else if (strain && genotypeName && strain !== genotypeName) {
            debug(`conflict: specimen strain from ${exportNeuron.idString} ("${strain}") differs from ${genotypeSource} ("${genotypeName}"); keeping first value`);
        }
    }

    return {referenceDate, genotypeName};
}

function findInjectionAtlasStructureId(specimen: Specimen, exportNeurons: MlExportNeuron[]): string | null {
    for (const exportNeuron of exportNeurons) {
        const structureId = exportNeuron.soma?.allenId;
        if (structureId != null) {
            return specimen.getAtlas().getFromStructureId(structureId)?.id ?? null;
        }
    }

    return null;
}

async function importSpecimen(collection: Collection, sample: MlSample, metadata: SpecimenMetadata): Promise<Specimen> {
    const label = String(sample.idNumber);

    const shape: SpecimenShape = {
        label,
        collectionId: collection.id,
        referenceDate: metadata.referenceDate,
        genotypeName: metadata.genotypeName
    };

    const specimen = await Specimen.createOrUpdateForShape(shape, User.SystemAutomationUser, {allowCreate: true, allowMatchLabel: true});

    debug(`specimen "${label}" ready (${specimen.id}, genotype=${metadata.genotypeName ?? "none"}, date=${metadata.referenceDate?.toISOString() ?? "none"})`);

    return specimen;
}

async function importInjectionIfComplete(specimen: Specimen, injectionAtlasStructureId: string | null, exportNeuron: MlExportNeuron): Promise<void> {
    const virus = exportNeuron.label?.virus;
    const fluorophore = exportNeuron.label?.fluorophore;

    if (virus == null || fluorophore == null) {
        debug(`skipping injection for ${exportNeuron.idString}: virus=${virus}, fluorophore=${fluorophore}`);
        return;
    }

    if (!injectionAtlasStructureId) {
        debug(`error: injection for ${exportNeuron.idString} has virus and fluorophore but no atlas structure could be resolved from soma`);
        return;
    }

    const existingInjection = await Injection.findOne({
        where: {
            specimenId: specimen.id,
            atlasStructureId: injectionAtlasStructureId
        }
    });

    const injectionShape: InjectionShape = {
        id: existingInjection?.id,
        specimenId: specimen.id,
        atlasStructureId: injectionAtlasStructureId,
        injectionVirusName: virus,
        fluorophoreName: fluorophore
    };

    const injection = await Injection.createOrUpdateForShape(User.SystemAutomationUser, injectionShape, true);

    debug(`injection for specimen ${specimen.id} ready (${injection.id}, virus="${virus}", fluorophore="${fluorophore}")`);
}

async function importNeuron(specimen: Specimen, mlNeuron: MlNeuron, exportNeuron: MlExportNeuron): Promise<Neuron> {
    if (!exportNeuron.soma) {
        throw new Error(`MouseLight JSON export for ${mlNeuron.idString} is missing soma`);
    }

    const atlasSoma = {x: exportNeuron.soma.x, y: exportNeuron.soma.y, z: exportNeuron.soma.z};

    const atlasStructureId = mlNeuron.brainArea?.structureId == null
        ? null
        : specimen.getAtlas().getFromStructureId(mlNeuron.brainArea.structureId)?.id ?? null;

    const neuronShape: NeuronShape = {
        specimenId: specimen.id,
        label: mlNeuron.idString,
        atlasSoma,
        specimenSoma: {x: 0, y: 0, z: 0},
        atlasStructureId,
        // MouseLight supplies keywords as one comma-separated string, a convention that is this source's
        // alone - the split has to happen here because nothing downstream treats a comma as a separator.
        keywords: normalizeKeywords((mlNeuron.keywords ?? "").split(","))
    };

    const neuron = await Neuron.createOrUpdateForShape(neuronShape, User.SystemAutomationUser, {allowCreate: true, allowMatchLabel: true});

    if (exportNeuron.DOI?.trim()) {
        await neuron.update({canonicalDoi: exportNeuron.DOI.trim()});
    }

    debug(`neuron "${neuron.label}" ready (${neuron.id}, specimen=${specimen.label}, brainArea=${mlNeuron.brainArea?.acronym ?? "none"}, doi=${exportNeuron.DOI ?? "none"})`);

    return neuron;
}

async function importAtlasReconstruction(neuronId: string, idString: string, swcPath: string, doi?: string): Promise<void> {
    let reconstruction = await Reconstruction.findOrOpenReconstruction(
        neuronId,
        User.SystemAutomationUser,
        User.SystemAutomationUser
    );

    if (immutableReconstructionStatus.includes(reconstruction.status)) {
        debug(`${reconstruction.id} (${idString}) skipped ${ReconstructionStatus[reconstruction.status]}`);
        return;
    }

    await Reconstruction.requestReview({
        reconstructionId: reconstruction.id,
        targetStatus: ReconstructionStatus.PublishReview
    }, User.SystemAutomationUser, User.SystemAutomationUser, true);

    await Reconstruction.fromSwcFile(
        User.SystemAutomationUser,
        reconstruction.id,
        swcPath,
        ReconstructionSpace.Atlas,
        User.SystemAutomationUser
    );

    if (doi?.trim()) {
        const atlasReconstruction = await reconstruction.getAtlasReconstruction();
        await atlasReconstruction.update({doi: doi.trim()});
    }

    reconstruction = await Reconstruction.approveReconstruction(
        reconstruction.id,
        ReconstructionStatus.Approved,
        User.SystemAutomationUser,
        User.SystemAutomationUser,
        true
    );

    if (reconstruction.status !== ReconstructionStatus.WaitingForAtlasReconstruction) {
        debug(`failed to approve MouseLight reconstruction ${reconstruction.id} (${idString})`);
    }
}

async function mouselightImport(config: MouseLightImportConfig): Promise<void> {
    const baseUrl = buildBaseUrl(config.host, config.port);

    debug(`MouseLight import from ${baseUrl}`);

    await RemoteDatabaseClient.Start(false, false);

    const collection = await Collection.createOrUpdateForShape(
        User.SystemAutomationUser,
        {name: "MouseLight"},
        true
    );

    debug(`collection "${collection.name}" ready (${collection.id})`);

    debug("querying MouseLight neurons...");

    const {neurons} = await queryMouseLight<{neurons: MlNeuron[]}>(baseUrl, neuronsQuery);

    debug(`received ${neurons.length} neurons from GraphQL`);

    const filtered = config.specimenIdNumber != null
        ? neurons.filter(mlNeuron => mlNeuron.sample?.idNumber === config.specimenIdNumber)
        : neurons;

    if (config.specimenIdNumber != null) {
        debug(`filtered to ${filtered.length} neurons for specimen ${config.specimenIdNumber}`);
    }

    const enriched: EnrichedNeuron[] = [];
    for (const mlNeuron of filtered) {
        try {
            const jsonPath = await ensureJsonFile(baseUrl, config.cacheDir, mlNeuron.idString, config.resetCache);
            const exportNeuron = await readExportNeuron(jsonPath, mlNeuron.idString);
            enriched.push({mlNeuron, exportNeuron});
        } catch (error) {
            debug(`error fetching JSON export for ${mlNeuron.idString}: ${error.message}`);
            debug(error);
        }
    }

    const bySample = groupBySample(enriched);

    debug(`processing ${bySample.size} samples`);

    for (const sampleGroup of bySample.values()) {
        const specimenMetadata = chooseSpecimenMetadata(sampleGroup.items.map(item => item.exportNeuron));

        let specimen: Specimen;

        try {
            specimen = await importSpecimen(collection, sampleGroup.sample, specimenMetadata);
        } catch (error) {
            debug(`error importing specimen ${sampleGroup.sample.idNumber}: ${error.message}`);
            debug(error);
            continue;
        }

        const injectionAtlasStructureId = findInjectionAtlasStructureId(
            specimen,
            sampleGroup.items.map(item => item.exportNeuron)
        );

        for (const {mlNeuron, exportNeuron} of sampleGroup.items) {
            try {
                await importInjectionIfComplete(specimen, injectionAtlasStructureId, exportNeuron);

                const neuron = await importNeuron(specimen, mlNeuron, exportNeuron);

                if (!skipReconstructions) {
                    const swcPath = await ensureSwcFile(baseUrl, config.cacheDir, mlNeuron.idString, config.resetCache);
                    await importAtlasReconstruction(neuron.id, mlNeuron.idString, swcPath, exportNeuron.DOI);
                }
            } catch (error) {
                debug(`error processing MouseLight neuron ${mlNeuron.idString}: ${error.message}`);
                debug(error);
            }
        }
    }

    debug("MouseLight import complete");
}

const args = process.argv.slice(2);

const resetCache = args.includes("-r") || args.includes("--reset-cache");

let specimenIdNumber: number | undefined;
for (let idx = 0; idx < args.length; idx++) {
    if (args[idx] === "-s" || args[idx] === "--specimen") {
        const raw = args[idx + 1];
        if (raw == null || isNaN(Number(raw))) {
            console.error(`--specimen requires a numeric idNumber argument`);
            process.exit(1);
        }
        specimenIdNumber = Number(raw);
        break;
    }
}

const flagsWithArgs = new Set(["-s", "--specimen"]);
const flagsWithoutArgs = new Set(["-r", "--reset-cache", "--"]);
const positional: string[] = [];
for (let idx = 0; idx < args.length; idx++) {
    if (flagsWithArgs.has(args[idx])) {
        idx++;
    } else if (!flagsWithoutArgs.has(args[idx])) {
        positional.push(args[idx]);
    }
}

const host = positional[0] ?? "https://ml-neuronbrowser.janelia.org";
const port = positional[1] || undefined;
const cacheDir = positional[2] ?? ".cache/mouselight-import";

const start = performance.now();

mouselightImport({host, port, cacheDir, resetCache, specimenIdNumber}).then(() => {
    debug(`completed in ${((performance.now() - start) / 1000).toFixed(3)}s`);
}).catch((error) => {
    console.error(`MouseLight import failed: ${error.message}`);
    console.error(error);
    process.exit(1);
});
