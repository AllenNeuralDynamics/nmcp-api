import * as fs from "fs";
import * as path from "path";
import {glob} from "glob";

import {Cell, Client, createClient, Row, Sheet} from "smartsheet";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {AtlasStructure} from "../models/atlasStructure";
import {Neuron, NeuronShape} from "../models/neuron";
import {ReferenceDataset, Specimen, SpecimenShape, SpecimenTomography} from "../models/specimen";
import {Collection} from "../models/collection";
import {User} from "../models/user";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {ReconstructionSpace} from "../models/reconstructionSpace";
import {Atlas} from "../models/atlas";
import {isNullOrEmpty} from "../util/objectUtil";
import moment = require("moment");

const debug = require("debug")("nmcp:api:smartsheet");

const specimenSpaceReconstructionDirectory = "specimen";
const atlasSpaceReconstructionDirectory = "atlas";

enum ColumnName {
    CCFCoordinates = "CCF Coordinates",
    HortaCoordinates = "Horta Coordinates",
    EstimatedSomaCompartment = "Manual Estimated Soma Compartment",
    CcfSomaCompartment = "CCF Soma Compartment",
    Collection = "Collection",
    Level = "Level",
    Id = "ID",
    Genotype = "Genotype",
    Notes = "Notes",
    DateStarted = "Date Started",
    DateCompleted = "Date Completed",
    Annotator1 = "Annotator 1",
    Status1 = "Status 1",
    Annotator2 = "Annotator 2",
    Status2 = "Status 2",
    NeuronLength = "Neuron Length (mm)",
    Duration = "Time to Trace (hrs)",
    Checks = "Checks",
    Proofreader = "Proofreader",
    Assigned = "Assigned",
    Production = "Production",
    Test = "Test"
}

// Smartsheet definitions
enum Status {
    InProgress = "In Progress",
    Hold = "Hold",
    PendingReview = "Pending Review",
    Completed = "Completed",
    // Incomplete = "Incomplete",
    Untraceable = "Untraceable"
}

const statusValues = Object.values(Status);

type SpecimenRowContents = {
    subjectId: string;
    specimenDate: Date;
    genotype: string;
    notes: string;
    collectionName: string;
    neurons: NeuronRowContents[];
}

type NeuronRowContents = {
    id?: string;
    idString: string;
    atlasSoma: {
        x: number;
        y: number;
        z: number;
    };
    specimenSoma: {
        x: number;
        y: number;
        z: number;
    };
    manualBrainStructureAcronym: string;
    ccfBrainStructureAcronym: string;
    annotator: string;
    annotatorEmail: string;
    status: Status;
    annotator2: string;
    annotator2Email: string;
    status2: Status;
    length: number;
    duration: number;
    notes: string;
    checks: string;
    proofreader: string;
    proofreaderEmail: string;
    assigned: string;
    startedAt: Date;
    completedAt: Date;
}

enum ImportQualifier {
    All = 0,
    Production = 1,
    Test = 2
}

type ParsedNeuronIdWithSpecimen = [string, SpecimenRowContents];

type DefaultUser = {
    authId: string;
    firstName: string;
    lastName: string;
    email: string;
    permissions: number
}

// Some ugly globals while we figure out what we want.
const specimensMissingReconstructionDirectory = [];
const specimenReconstructionNotFound = [];
const atlasReconstructionNotFound = [];
const ccfMissing = [];
const ccfCoordinatesParseFailed = [];
const specimenCoordinatesParseFailed = [];
const ccfLookupFailed = [];
const failedToApprove = [];

// Observational accumulators for the post-run markdown report.  These only record what the import did and never influence its behavior.
type ReconstructionReportEntry = { id: string; subjectId: string; neuron: string; status?: string };

const importReport = {
    newSpecimens: [] as string[],
    existingSpecimensWithChanges: new Set<string>(),
    neuronsAdded: [] as { subjectId: string; neuron: string }[],
    neuronsModified: [] as { subjectId: string; neuron: string }[],
    existingNeuronsWithReconstructionChanges: new Set<string>(),
    reconstructionsAdded: new Map<string, ReconstructionReportEntry>(),
    reconstructionsModified: new Map<string, ReconstructionReportEntry>(),
    reconstructionsWithData: new Set<string>(),
    reconstructionsSkippedImmutable: [] as ReconstructionReportEntry[]
};

const neuronSelection = {
    // "613814": []
};

const specimenSubset = [...new Set(Object.keys(neuronSelection))];

// Should be an argument but testing for now.
const allowMissingCCF = true;

function smartSheetImport(sheetId: number, importQualifier: ImportQualifier, pathToReconstructions: string, defaultUsers: DefaultUser[] = []): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const token = process.env.SS_API_TOKEN;

        if (!token) {
            debug("SmartSheet access token required.");
            reject(new Error("SmartSheet access token required."));
        }

        const insertReconstructions = !isNullOrEmpty(pathToReconstructions);

        debug(`SmartSheet import from ${sheetId}. Import Qualifier: ${ImportQualifier[importQualifier]}, Parse files: ${insertReconstructions}`)

        await RemoteDatabaseClient.Start(false, false);

        if (specimenSubset.length > 0) {
            debug(`limiting specimens to ${specimenSubset.toString()}`);
        }

        await populateDefaults(defaultUsers);

        const s = new SmartSheetImport(token);

        await s.parseSheet(sheetId, importQualifier);

        // If true, but insertReconstructions is false, will perform the transaction to insert to check for errors, but rollback the insert to leave tracing data
        // untouched.  This generally only changed to false in order to speed testing of other parts of the bulk sheet import process.
        const testFlightInsertion = true;

        await s.updateDatabase(insertReconstructions, testFlightInsertion);

        s.print(sheetId, importQualifier);

        resolve();
    });
}

function isReadyToImport(status: Status): boolean {
    return status == Status.Completed || status == Status.PendingReview || status == Status.InProgress;
}

function reconstructionStatusForSmartSheetStatus(status: Status): ReconstructionStatus {
    switch (status) {
        case Status.InProgress:
            return ReconstructionStatus.InProgress;
        case Status.Hold:
            return ReconstructionStatus.OnHold;
        case Status.PendingReview:
            return ReconstructionStatus.PublishReview;
        case Status.Completed:
            return ReconstructionStatus.Approved;
        case Status.Untraceable:
            return ReconstructionStatus.Discarded;
    }
}

async function ensureUser(name: string, email: string) {
    if (name && email) {
        let names = name.split(" ").map(s => s.trim());

        // Special exception for AIND-specific smartsheet variation - this user dropdown entry does not have email value w/display name.
        if (email == "kevianna.adams@alleninstitute.org") {
            names = ["Kevianna", "Adams"];
        }

        return await User.findOrCreateUser(null, names.length > 0 ? names[0] : "", names.length > 1 ? names[1] : "", email, User.SystemAutomationUser)
    }

    return null;
}

function findBrainCompartmentSimple(atlas: Atlas, label: string): AtlasStructure {
    return atlas.matchAnyLabel(label);
}

function findBrainCompartment(atlas: Atlas, primaryLabel: string, secondaryLabel: string): AtlasStructure {
    return findBrainCompartmentSimple(atlas, primaryLabel) ?? findBrainCompartmentSimple(atlas, secondaryLabel);
}

const immutableReconstructionStatus = [ReconstructionStatus.Published, ReconstructionStatus.Archived, ReconstructionStatus.Discarded];

// Treats null, undefined, and entries without a usable url (e.g. an empty object) as "no value provided".
function hasMetadataValue(value: { url?: string } | null | undefined): boolean {
    return !!value && typeof value.url === "string" && value.url.trim().length > 0;
}

async function specimenDataFromRow(s: SpecimenRowContents, insertReconstructions: boolean, testFlightInsertion: boolean = true) {
    const collection = await Collection.findByName(s.collectionName);

    if (!collection) {
        debug(`no matching collection ${s.collectionName} for specimen ${s.subjectId}`);
        return;
    }

    const shape: SpecimenShape = {
        label: s.subjectId,
        referenceDate: s.specimenDate,
        genotypeName: s.genotype,
        notes: s.notes,
        collectionId: collection.id
    };

    const metadata = specimenMetadata.find(m => m.subject == s.subjectId);

    if (metadata) {
        // Only apply these when the metadata actually carries a value.  Otherwise leave the property off the shape so an
        // existing specimen's tomography/reference dataset is preserved rather than clobbered by a missing/empty entry.
        if (hasMetadataValue(metadata.tomography)) {
            shape.tomography = metadata.tomography;
        }

        if (hasMetadataValue(metadata.referenceDataset)) {
            shape.referenceDataset = metadata.referenceDataset;
        }
    }

    let specimen: Specimen;

    const specimenExisted = !!(await Specimen.findOne({where: {label: shape.label}}));

    try {
        specimen = await Specimen.createOrUpdateForShape(shape, User.SystemAutomationUser, {
            allowCreate: true,
            allowMatchLabel: true
        });
    } catch (e) {
        debug(`error with createOrUpdateForShape for specimen ${s.subjectId}`)
        debug(e);
        return;
    }

    if (!specimenExisted) {
        importReport.newSpecimens.push(s.subjectId);
    }

    const suitableReconstructions: NeuronRowContents[] = [];

    // Neuron ids that already existed prior to this import, used to attribute later reconstruction changes.
    const existingNeuronIds = new Set<string>();

    for (const n of s.neurons) {
        let somaAtlasStructure = findBrainCompartment(specimen.getAtlas(), n.manualBrainStructureAcronym, n.ccfBrainStructureAcronym)?.id

        if (!somaAtlasStructure) {
            ccfLookupFailed.push({
                subject: s.subjectId,
                neuron: n.idString,
                manual: n.manualBrainStructureAcronym,
                ccf: n.ccfBrainStructureAcronym,
                value: [n.manualBrainStructureAcronym, n.ccfBrainStructureAcronym].filter(label => label).join(" / ")
            });
        }

        const assigned = n.assigned?.trim() ?? "";

        const shape: NeuronShape = {
            specimenId: specimen.id,
            label: n.idString,
            atlasSoma: n.atlasSoma,
            specimenSoma: n.specimenSoma,
            atlasStructureId: somaAtlasStructure,
            keywords: assigned.length > 0 ? [assigned] : []
        };

        const neuronExisted = !!(await Neuron.findOne({where: {label: shape.label, specimenId: specimen.id}}));

        try {
            const neuron = await Neuron.createOrUpdateForShape(shape, User.SystemAutomationUser, {
                allowCreate: true,
                allowMatchLabel: true
            });
            n.id = neuron.id;
            suitableReconstructions.push(n);

            if (neuronExisted) {
                existingNeuronIds.add(neuron.id);
                importReport.neuronsModified.push({subjectId: s.subjectId, neuron: n.idString});
            } else {
                importReport.neuronsAdded.push({subjectId: s.subjectId, neuron: n.idString});
            }

            if (specimenExisted) {
                importReport.existingSpecimensWithChanges.add(s.subjectId);
            }

            debug(`neuron ${neuron.label} (specimen ${specimen.label}) OK`)
        } catch (e) {
            debug(`error with createOrUpdateForShape for neuron ${n.idString} (specimen ${specimen.label})`)
        }
    }

    const neuronsForReconstructions = suitableReconstructions.filter(n => isReadyToImport(n.status));

    const users = new Map<string, User>()

    // Ensure users exist where applicable.  Must happen serially to avoid duplicate user creation.
    await neuronsForReconstructions.reduce(async (promise: Promise<void>, n): Promise<void> => {
        await promise;

        let user = await ensureUser(n.annotator, n.annotatorEmail);

        if (user) {
            users.set(n.annotatorEmail, user);
        }

        user = await ensureUser(n.annotator2, n.annotator2Email);

        if (user) {
            users.set(n.annotator2Email, user);
        }

        user = await ensureUser(n.proofreader, n.proofreaderEmail);

        if (user) {
            users.set(n.proofreaderEmail, user);
        }
    }, Promise.resolve());

    for (const n of neuronsForReconstructions) {
        if (!n.id) {
            // Earlier issue w/parsing - neuron not created.
            continue;
        }

        const annotator1 = users.get(n.annotatorEmail);

        const annotator2 = users.get(n.annotator2Email);

        const annotator = annotator1 ?? annotator2;

        const proofreader = users.get(n.proofreaderEmail);

        if (!annotator) {
            debug(`neuron ${n.idString}-${s.subjectId} is missing annotator - skipped`)
            continue;
        }
        const targetStatus = reconstructionStatusForSmartSheetStatus(n.status);

        try {
            const reconstructionExisted = !!(await Reconstruction.findOne({
                where: {
                    annotatorId: annotator.id,
                    neuronId: n.id
                }
            }));

            // This tool assumes one instance of a reconstruction per annotator, per candidate.  If the information in SmartSheets is meant to allow a second
            // reconstruction for the same annotator on the same neuron/candidate, this must be changed.
            let reconstruction = await Reconstruction.findOrOpenReconstruction(n.id, annotator, User.SystemAutomationUser);

            // Do not modify a published, archived, or discarded reconstructions.
            if (immutableReconstructionStatus.includes(reconstruction.status)) {
                importReport.reconstructionsSkippedImmutable.push({
                    id: reconstruction.id,
                    subjectId: s.subjectId,
                    neuron: n.idString,
                    status: ReconstructionStatus[reconstruction.status]
                });
                debug(`${reconstruction.id} (${n.idString}-${s.subjectId}) skipped ${ReconstructionStatus[reconstruction.status]}.`)
                continue;
            }

            if (reconstructionExisted) {
                importReport.reconstructionsModified.set(reconstruction.id, {
                    id: reconstruction.id,
                    subjectId: s.subjectId,
                    neuron: n.idString
                });
            } else {
                importReport.reconstructionsAdded.set(reconstruction.id, {
                    id: reconstruction.id,
                    subjectId: s.subjectId,
                    neuron: n.idString
                });
            }

            // A reconstruction was added to or modified on a neuron that already existed before this import.
            if (existingNeuronIds.has(n.id)) {
                importReport.existingNeuronsWithReconstructionChanges.add(`${s.subjectId}-${n.idString}`);
            }

            const checks = n.checks ? "\n" + n.checks : "";

            debug(`updating reconstruction ${reconstruction.id} (${n.idString}-${s.subjectId})`);

            const updates = {
                notes: n.notes + checks,
                durationHours: isNaN(n.duration) ? null : n.duration,
                startedAt: n.startedAt ?? null,
                completedAt: n.completedAt ?? null
            };

            await reconstruction.update(updates);

            switch (targetStatus) {
                case ReconstructionStatus.InProgress:
                    continue;
                case ReconstructionStatus.OnHold:
                    await Reconstruction.pauseReconstruction(reconstruction.id, annotator, User.SystemAutomationUser)
                    continue;
                case ReconstructionStatus.PublishReview:
                    await Reconstruction.requestReview({
                        reconstructionId: reconstruction.id,
                        targetStatus: ReconstructionStatus.PublishReview
                    }, annotator, User.SystemAutomationUser, true);
                    continue;
                case ReconstructionStatus.Approved:
                    // Approve is not viable b/c reconstruction has not been uploaded.  Try after that is performed below.
                    await Reconstruction.requestReview({
                        reconstructionId: reconstruction.id,
                        targetStatus: ReconstructionStatus.PublishReview
                    }, annotator, User.SystemAutomationUser, true);
                    break;
                case ReconstructionStatus.Discarded:
                    await Reconstruction.discardReconstruction(reconstruction.id, annotator, User.SystemAutomationUser);
                    continue;
            }

            if (insertReconstructions || testFlightInsertion) {
                const specimenDataLoaded = await loadSpecimenReconstruction(reconstruction, s.subjectId, n.idString, annotator);

                const atlasDataLoaded = await loadAtlasReconstruction(reconstruction, s.subjectId, n.idString, targetStatus, proofreader);

                if (specimenDataLoaded || atlasDataLoaded) {
                    importReport.reconstructionsWithData.add(reconstruction.id);
                }
            }
        } catch (error) {
            debug(error);
        }
    }
}

// Caches whether each subject's top-level reconstruction directory was found so it is only globbed (and reported) once per specimen.
const reconstructionDirectoryChecked = new Map<string, boolean>();

// Returns true when there is a top-level subject directory under the reconstruction location (or when there is no location to inspect, leaving
// the normal not-found handling in place).  The first time a subject's directory is found to be missing it is recorded for reporting.
async function reconstructionDirectoryExists(baseLocation: string, subjectId: string): Promise<boolean> {
    if (isNullOrEmpty(baseLocation)) {
        return true;
    }

    if (reconstructionDirectoryChecked.has(subjectId)) {
        return reconstructionDirectoryChecked.get(subjectId);
    }

    const matches = await glob(path.posix.join(baseLocation, "**", subjectId) + "/");

    const exists = matches.length > 0;

    reconstructionDirectoryChecked.set(subjectId, exists);

    if (!exists) {
        specimensMissingReconstructionDirectory.push(subjectId);
        debug(`\t---> reconstruction directory not found for specimen ${subjectId}`);
    }

    return exists;
}

async function loadSpecimenReconstruction(reconstruction: Reconstruction, subjectId: string, neuronLabel: string, annotator: User): Promise<boolean> {
    const filePrefix = `${neuronLabel}-${subjectId}`;

    try {
        if (!(await reconstructionDirectoryExists(reconstructionLocation, subjectId))) {
            return false;
        }

        const swcPath = await findSpecimenReconstructionFile(reconstructionLocation, subjectId, filePrefix);

        if (swcPath) {
            debug(`\tupdating or adding specimen reconstruction data for ${reconstruction.id} (${subjectId}-${neuronLabel})`);

            try {
                await Reconstruction.fromSwcFile(annotator ?? User.SystemAutomationUser, reconstruction.id, swcPath, ReconstructionSpace.Specimen, User.SystemAutomationUser);
                return true;
            } catch (error) {
                debug(`\t---> parsing error for ${swcPath}`);
                debug(error);
                debug(`\t---`);
            }
        } else if (reconstruction.specimenNodeCounts) {
            debug(`\tspecimen reconstruction data file not found, but data already present for ${reconstruction.id} (${subjectId}-${neuronLabel})`);
        } else {
            specimenReconstructionNotFound.push({subject: subjectId, neuron: neuronLabel});
            debug(`\t---> expected specimen reconstruction data not found for ${reconstruction.id} (${subjectId}-${neuronLabel})`);
        }
    } catch (err) {
        debug(`---> issue detecting specimen reconstruction data for ${reconstruction.id} (${subjectId}-${neuronLabel})`);
        console.log(err);
    }

    return false;
}

async function loadAtlasReconstruction(reconstruction: Reconstruction, subjectId: string, neuronLabel: string, targetStatus: ReconstructionStatus, proofreader: User): Promise<boolean> {
    const filePrefix = `${neuronLabel}-${subjectId}`;

    try {
        if (!(await reconstructionDirectoryExists(reconstructionLocation, subjectId))) {
            return false;
        }

        const jsonPath = await findAtlasReconstructionFile(reconstructionLocation, subjectId, filePrefix);

        if (jsonPath) {
            debug(`\tupdating or adding atlas reconstruction data for ${reconstruction.id} (${subjectId}-${neuronLabel})`)
            try {
                await Reconstruction.fromSwcFile(proofreader ?? User.SystemAutomationUser, reconstruction.id, jsonPath, ReconstructionSpace.Atlas, User.SystemAutomationUser);

                if (targetStatus == ReconstructionStatus.Approved) {
                    reconstruction = await Reconstruction.approveReconstruction(reconstruction.id, ReconstructionStatus.Approved, proofreader ?? User.SystemAutomationUser, User.SystemAutomationUser, true);
                    if (reconstruction.status != ReconstructionStatus.WaitingForAtlasReconstruction) {
                        failedToApprove.push(`${reconstruction.id} (${subjectId}-${neuronLabel})`);
                        debug(`failed to approve reconstruction ${reconstruction.id} (${subjectId}-${neuronLabel})`);
                    }
                }

                return true;
            } catch (error) {
                debug(`\t---> parsing error for ${jsonPath}`);
                debug(error);
                debug(`\t---`);
            }
        } else {
            const existingAtlasReconstruction = await reconstruction.getAtlasReconstruction();

            if (existingAtlasReconstruction?.nodeCounts) {
                debug(`\tatlas reconstruction data file not found, but data already present for ${reconstruction.id} (${subjectId}-${neuronLabel})`);
            } else {
                atlasReconstructionNotFound.push({
                    subject: subjectId,
                    neuron: neuronLabel,
                    status: reconstruction.status
                });

                if (reconstruction.status == ReconstructionStatus.Approved) {
                    debug(`\t---> expected atlas reconstruction data not found for ${reconstruction.id} (${subjectId}-${neuronLabel})`);
                } else {
                    debug(`\t---> failed to find atlas reconstruction data for unexpected status: ${reconstruction.status} for: ${reconstruction.id} (${subjectId}-${neuronLabel})`);
                }
            }
        }
    } catch (err) {
        debug(`---> issue detecting atlas reconstruction data for ${reconstruction.id} (${subjectId}-${neuronLabel})`);
        console.log(err);
    }

    return false;
}

// Number of entries shown per row in the report grids.  Must be even so the two-column tables can repeat their columns evenly.
const reportGridColumns = 8;

// Returns null for an empty list so the caller can omit the subsection entirely.  Renders the values as a compact,
// column-aligned grid (a fenced code block, so there is no header) with several entries per row.  An optional description
// is rendered in italics below the header.
function renderReportSection(title: string, lines: string[], description: string = null): string | null {
    if (lines.length == 0) {
        return null;
    }

    const columns = reportGridColumns;

    const rows: string[][] = [];

    for (let idx = 0; idx < lines.length; idx += columns) {
        rows.push(lines.slice(idx, idx + columns).map(line => line.replace(/\r?\n/g, " ")));
    }

    const columnWidths: number[] = [];

    for (let column = 0; column < columns; column++) {
        columnWidths[column] = Math.max(0, ...rows.map(row => (row[column] ?? "").length));
    }

    const grid = rows
        .map(row => row.map((cell, column) => cell.padEnd(columnWidths[column])).join("  ").trimEnd())
        .join("\n");

    const descriptionLine = description ? `_${description}_\n\n` : "";

    return `#### ${title}\n\n${descriptionLine}\`\`\`\n${grid}\n\`\`\`\n`;
}

// Escapes characters that would otherwise break a markdown table cell.
function escapeTableCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Returns null for an empty set of rows so the caller can omit the subsection entirely.  The two-column header is repeated
// across the row to match the grid width used by the list sections, packing that many entries per row.  An optional
// description is rendered in italics below the header.
function renderReportTable(title: string, headers: string[], rows: string[][], description: string = null): string | null {
    if (rows.length == 0) {
        return null;
    }

    const repeats = reportGridColumns / 2;

    const repeatedHeaders = Array(repeats).fill(headers).flat();
    const headerRow = `| ${repeatedHeaders.join(" | ")} |`;
    const dividerRow = `| ${repeatedHeaders.map(() => "---").join(" | ")} |`;

    const bodyRows: string[] = [];

    for (let idx = 0; idx < rows.length; idx += repeats) {
        const cells: string[] = [];

        for (let offset = 0; offset < repeats; offset++) {
            const sourceRow = rows[idx + offset];

            for (let column = 0; column < headers.length; column++) {
                cells.push(escapeTableCell(sourceRow?.[column] ?? ""));
            }
        }

        bodyRows.push(`| ${cells.join(" | ")} |`);
    }

    const descriptionLine = description ? `_${description}_\n\n` : "";

    return `#### ${title}\n\n${descriptionLine}${headerRow}\n${dividerRow}\n${bodyRows.join("\n")}\n`;
}

// Writes a markdown summary of what the import did to the current directory.  Purely observational; mirrors the logging output but in a durable file.
function writeImportReport(sheetId: number, importQualifier: ImportQualifier) {
    const runMoment = moment();
    const timestamp = runMoment.format("YYYY-MM-DD_HH-mm-ss");

    const addedReconstructions = Array.from(importReport.reconstructionsAdded.values());
    const addedWithData = addedReconstructions.filter(entry => importReport.reconstructionsWithData.has(entry.id));
    const addedWithoutData = addedReconstructions.filter(entry => !importReport.reconstructionsWithData.has(entry.id));

    const modifiedWithData = Array.from(importReport.reconstructionsModified.values()).filter(entry => importReport.reconstructionsWithData.has(entry.id));

    const reconstructionLabel = (entry: ReconstructionReportEntry) => `${entry.subjectId}-${entry.neuron}`;

    // Sorted "Neuron"/"Invalid Value" rows for the coordinate parse-failure tables.
    const parseFailureRows = (entries: { subject: string; neuron: string; value?: string }[]): string[][] =>
        entries
            .slice()
            .sort((first, second) => `${first.subject}-${first.neuron}`.localeCompare(`${second.subject}-${second.neuron}`))
            .map(entry => [`${entry.subject}-${entry.neuron}`, entry.value ?? ""]);

    const notEmpty = (section: string | null): section is string => section !== null;

    const importSections = [
        renderReportSection("Specimens Added", importReport.newSpecimens.slice().sort()),
        renderReportSection("Specimens Updated", Array.from(importReport.existingSpecimensWithChanges).sort()),
        renderReportSection("Neurons Added", importReport.neuronsAdded.map(entry => `${entry.subjectId}-${entry.neuron}`).sort()),
        renderReportSection("Neurons Updated", importReport.neuronsModified.map(entry => `${entry.subjectId}-${entry.neuron}`).sort()),
        renderReportSection("Neurons with Reconstructions Changes", Array.from(importReport.existingNeuronsWithReconstructionChanges).sort()),
        renderReportSection("Reconstructions Added with Reconstruction Data", addedWithoutData.map(reconstructionLabel).sort()),
        renderReportSection("Reconstructions Added without Reconstruction Data", addedWithData.map(reconstructionLabel).sort()),
        renderReportSection("Reconstructions with Updated Reconstruction Data", modifiedWithData.map(reconstructionLabel).sort()),
        renderReportSection("Reconstructions not Updated (published or other immutable state)", importReport.reconstructionsSkippedImmutable.map(entry => `${entry.subjectId}-${entry.neuron} (${entry.id}) - ${entry.status}`).sort())
    ].filter(notEmpty);

    const issueSections = [
        renderReportSection("Specimens Missing Reconstruction Directory", specimensMissingReconstructionDirectory.slice().sort(),
            "These entries may be expected if these specimens have already been fully imported in an earlier batch."),
        renderReportSection("Specimen-Space Reconstruction Data Not Found", specimenReconstructionNotFound.map(entry => `${entry.subject}-${entry.neuron}`).sort()),
        renderReportTable("Expected Atlas-Space Reconstruction Data Not Found", ["Neuron", "Status"],
            atlasReconstructionNotFound
                .slice()
                .sort((first, second) => `${first.subject}-${first.neuron}`.localeCompare(`${second.subject}-${second.neuron}`))
                .map(entry => [`${entry.subject}-${entry.neuron}`, ReconstructionStatus[entry.status]]),
            "The SmartSheet status for these reconstructions suggest the data should be available, but was not found (SWC file)."),
        renderReportTable("Specimen Soma Coordinates Failed to Parse", ["Neuron", "Invalid Value"], parseFailureRows(specimenCoordinatesParseFailed)),
        renderReportSection("Atlas Soma Coordinates Missing", ccfMissing.map(entry => `${entry.subject}-${entry.neuron}`).sort()),
        renderReportTable("Atlas Soma Coordinates Failed to Parse", ["Neuron", "Invalid Value"], parseFailureRows(ccfCoordinatesParseFailed)),
        renderReportTable("Atlas Structure Lookup for Soma Failed", ["Neuron", "Structure Label"], parseFailureRows(ccfLookupFailed)),
        renderReportSection("Reconstructions Failed Expected Approve Update", failedToApprove.slice().sort(),
            "It was expected that marking the reconstruction as approved would succeed, but it failed.")
    ].filter(notEmpty);

    const sections = [
        "### Summary\n\n"
        + `- SmartSheet sheet id: ${sheetId}\n`
        + `- Import qualifier: ${ImportQualifier[importQualifier]}\n`
        + `- Run at: ${runMoment.format("YYYY-MM-DD HH:mm:ss")}\n`,
        "---\n### Issues\n",
        ...(issueSections.length > 0 ? issueSections : ["_None_\n"]),
        "---\n### Import\n",
        ...importSections
    ];

    const fileName = `smartsheet-import-${timestamp}.md`;

    try {
        fs.writeFileSync(fileName, sections.join("\n") + "\n", "utf8");
        debug(`wrote import report to ${fileName}`);
    } catch (err) {
        debug(`failed to write import report to ${fileName}`);
        console.log(err);
    }
}

async function findSpecimenReconstructionFile(baseLocation: string, subjectId: string, file_prefix: string): Promise<string> {
    if (isNullOrEmpty(baseLocation)) {
        return null;
    }

    const filePattern = path.posix.join(baseLocation, "**", subjectId, specimenSpaceReconstructionDirectory, "**", `${file_prefix}*.swc`);

    debug(filePattern);

    const sources = await glob(filePattern);

    return sources?.length > 0 ? sources[0] : null;
}

async function findAtlasReconstructionFile(baseLocation: string, subjectId: string, file_prefix: string): Promise<string> {
    if (isNullOrEmpty(baseLocation)) {
        return null;
    }

    const filePattern = path.posix.join(baseLocation, "**", subjectId, atlasSpaceReconstructionDirectory, "**", `${file_prefix}*.swc`);

    const sources = await glob(filePattern);

    debug(filePattern);

    return sources?.length > 0 ? sources[0] : null;
}

class SmartSheetImport {
    private static columns: Map<ColumnName, number> = new Map();

    private _client: Client;

    // Specimens that will be included.
    private _specimens: Map<string, SpecimenRowContents>;

    // Specimens that may be used if a neuron meets the requirements.  Primarily this is used for the production instance where a subset of neurons may be
    // marked for production and the parent specimen is not.  Those specimens linger here until or unless an associated neuron is marked to use.
    private _pendingSpecimens: Map<string, SpecimenRowContents>;

    public constructor(token: string) {
        this._client = createClient({logLevel: "warn", accessToken: token});
    }

    public async parseSheet(sheetId: number, qualifier: ImportQualifier) {
        try {
            const sheet: Sheet = await this._client.sheets.getSheet({id: sheetId});

            debug(`populating database with content from from "${sheet.name}"`);

            this.findColumnIds(sheet);

            this._specimens = new Map();
            this._pendingSpecimens = new Map();

            sheet.rows.forEach((row: any) => {
                let cell = this.getCell(row, ColumnName.Level);

                if (cell.value == 1) {
                    this.parseSpecimen(row, qualifier);
                } else {
                    this.parseNeuron(row, qualifier);
                }
            });
        } catch (error) {
            console.log(error);
        }

        for (const s of this._specimens.values()) {
            s.neurons = s.neurons.sort((a, b) => a.idString.localeCompare(b.idString));
        }
    }

    public async updateDatabase(insertReconstructions: boolean, testFlightInsertion: boolean = true) {
        let ordered = Array.from(this._specimens.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));

        if (specimenSubset.length > 0) {
            ordered = ordered.filter(o => specimenSubset.includes(o.subjectId));
        }

        for (const s of ordered) {
            await specimenDataFromRow(s, insertReconstructions, testFlightInsertion);
        }
    }

    public print(sheetId: number, importQualifier: ImportQualifier) {
        const showPending = false;

        let ordered = Array.from(this._specimens.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
        if (ordered.length > 0) {
            debug(`subjects with imports:`);
            ordered.forEach(s => {
                if (s.neurons.length > 0) {
                    debug(`\t${s.subjectId} imported with ${s.neurons.length} neuron(s)`);
                }
            });
        }

        if (ordered.length > 0) {
            let needTitle = true;
            ordered.forEach(s => {
                if (s.neurons.length == 0) {
                    if (needTitle) {
                        debug(`subjects with expected imports that are missing:`);
                        needTitle = false;
                    }
                    debug(`\t${s.subjectId}`);
                }
            });
        }

        if (showPending) {
            ordered = Array.from(this._pendingSpecimens.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
            if (ordered.length > 0) {
                debug(`subjects stuck in pending:`);
                ordered.forEach(s => {
                    debug(`\t${s.subjectId}`);
                });
            }
        }

        if (specimensMissingReconstructionDirectory.length > 0) {
            debug("specimens missing reconstruction directory:")
            specimensMissingReconstructionDirectory.forEach(subject => {
                debug(`\t${subject}`);
            });
        }

        if (specimenReconstructionNotFound.length > 0) {
            debug("specimen reconstruction data not found:")
            specimenReconstructionNotFound.forEach(r => {
                debug(`\t${r.subject}-${r.neuron}`);
            });
        }

        if (atlasReconstructionNotFound.length > 0) {
            debug("atlas reconstruction data not found:")
            atlasReconstructionNotFound.forEach(r => {
                debug(`\t${r.subject}-${r.neuron} (${ReconstructionStatus[r.status]})`);
            });
        }

        if (ccfMissing.length > 0) {
            debug(`ccf soma coordinates missing ${allowMissingCCF ? "" : "(included due to allowMissingCCF = true)"}:`)
            debug(ccfMissing.map(r => `\t${r.subject}-${r.neuron}`).join(", "));
        }

        if (ccfCoordinatesParseFailed.length > 0) {
            debug("could not parse CCF soma coordinates:")
            ccfCoordinatesParseFailed.forEach(r => {
                debug(`\t${r.subject}-${r.neuron}`);
            });
        }

        if (specimenCoordinatesParseFailed.length > 0) {
            debug("could not parse specimen soma coordinates:")
            specimenCoordinatesParseFailed.forEach(r => {
                debug(`\t${r.subject}-${r.neuron}`);
            });
        }

        if (ccfLookupFailed.length > 0) {
            debug("failed to look up soma atlas structure:")
            ccfLookupFailed.forEach(r => {
                debug(`\t${r.subject}-${r.neuron}`);
            });
        }

        if (failedToApprove.length > 0) {
            debug("failed to approve reconstructions:")
            ccfLookupFailed.forEach(r => {
                debug(r);
            });
        }

        writeImportReport(sheetId, importQualifier);
    }

    private parseSpecimen(row: Row, qualifier: ImportQualifier) {
        const subjectId = this.getDisplayValue(row, ColumnName.Id);

        if (!this.includeSubject(subjectId)) {
            return;
        }

        const genotype = this.getStringValue(row, ColumnName.Genotype);
        const notes = this.getStringValue(row, ColumnName.Notes);
        const collectionName = this.getDisplayValue(row, ColumnName.Collection)

        const specimenDate = this.getDateValue(row, ColumnName.DateStarted);

        let cell = null;

        if (qualifier == ImportQualifier.Production) {
            cell = this.getCell(row, ColumnName.Production);
            if (!cell) {
                throw new Error("Failed to find Production column");
            }
        } else if (qualifier == ImportQualifier.Test) {
            cell = this.getCell(row, ColumnName.Test);
            if (!cell) {
                throw new Error("Failed to find Test column");
            }
        }

        const specimenRow = {
            subjectId,
            specimenDate,
            genotype,
            notes,
            collectionName,
            neurons: []
        };

        if (qualifier != ImportQualifier.All && cell?.value != true) {
            // debug(`pushing pending specimen ${subjectId}`);
            this._pendingSpecimens.set(subjectId, specimenRow);
        } else {
            // debug(`pushing specimen ${subjectId}`);
            this._specimens.set(subjectId, specimenRow);
        }
    }

    private parseNeuron(row: any, qualifier: ImportQualifier) {
        // When flagged for production or test instances, verify corresponding column.
        if (qualifier != ImportQualifier.All) {
            const cell = qualifier == ImportQualifier.Production ? this.getCell(row, ColumnName.Production) : this.getCell(row, ColumnName.Test);

            if (cell?.value != true) {
                // const id = this.getCell(row, ColumnName.Id).value as string;
                // console.log(`neuron ${id} is not marked for production and being skipped`);
                return;
            }
        }

        // Ensure we can identify the specimen.  This should just be the parent row, but this is a bit of a sanity
        // check that the neuron is named as we expect for other assumptions such as the reconstruction file name.
        const [id, specimen] = this.getSpecimenFromId(row);

        if (!id) {
            return;
        }

        if (!specimen) {
            // debug(`failed to find specimen for ${this.getStringValue(row, ColumnName.Id)} (row ${row.rowNumber})`);
            return;
        }

        const selectedNeurons = neuronSelection[specimen.subjectId];

        // An entry with an empty array means "all neurons for this specimen"; a populated array limits to the listed neurons.
        if (selectedNeurons !== undefined && selectedNeurons.length > 0 && !selectedNeurons.includes(id)) {
            // debug("exempted");
            return;
        }

        let horta = this.getCell(row, ColumnName.HortaCoordinates).value as string;

        const hortaValue = horta ?? "[0.0, 0.0, 0.0]";

        const specimenSoma = this.parseCoordinates(hortaValue);

        if (!specimenSoma) {
            specimenCoordinatesParseFailed.push({subject: specimen.subjectId, neuron: id, value: hortaValue});
            debug(`could not parse specimen (Horta) coordinates ${this.getStringValue(row, ColumnName.Id)} (row ${row.rowNumber})`);
        }

        let ccf = this.getCell(row, ColumnName.CCFCoordinates).value as string;

        const ccfWasMissing = !ccf;

        // Only processing rows that have a registered soma location.
        if (ccfWasMissing) {
            ccfMissing.push({subject: specimen.subjectId, neuron: id});

            if (!allowMissingCCF) {
                return;
            }

            ccf = "[0.0, 0.0, 0,0]";
        }

        const atlasSoma = this.parseCoordinates(ccf);

        // A missing value is already reported as such; only flag a value that was present but could not be parsed.
        if (!atlasSoma && !ccfWasMissing) {
            ccfCoordinatesParseFailed.push({subject: specimen.subjectId, neuron: id, value: ccf});
            debug(`could not parse CCF coordinates ${this.getStringValue(row, ColumnName.Id)} (row ${row.rowNumber})`);
        }

        const manualBrainStructureAcronym = this.getStringValue(row, ColumnName.EstimatedSomaCompartment);
        const ccfBrainStructureAcronym = this.getStringValue(row, ColumnName.CcfSomaCompartment);

        const neuron: NeuronRowContents = {
            idString: id,
            atlasSoma: atlasSoma,
            specimenSoma: specimenSoma,
            manualBrainStructureAcronym,
            ccfBrainStructureAcronym,
            annotator: this.getDisplayValue(row, ColumnName.Annotator1),
            annotatorEmail: this.getStringValue(row, ColumnName.Annotator1),
            status: this.getReconstructionStatus(row),
            annotator2: this.getDisplayValue(row, ColumnName.Annotator2),
            annotator2Email: this.getStringValue(row, ColumnName.Annotator2),
            status2: this.getReconstructionStatus(row, ColumnName.Status2),
            length: this.getNumberValue(row, ColumnName.NeuronLength),
            duration: this.getNumberValue(row, ColumnName.Duration),
            notes: this.getStringValue(row, ColumnName.Notes),
            checks: this.getStringValue(row, ColumnName.Checks),
            proofreader: this.getDisplayValue(row, ColumnName.Proofreader),
            proofreaderEmail: this.getStringValue(row, ColumnName.Proofreader),
            assigned: this.getStringValue(row, ColumnName.Assigned),
            startedAt: this.getDateValue(row, ColumnName.DateStarted),
            completedAt: this.getDateValue(row, ColumnName.DateCompleted)
        };

        specimen.neurons.push(neuron);
    }

    private getSpecimenFromId(row: any): ParsedNeuronIdWithSpecimen {
        const id = this.getCell(row, ColumnName.Id).value as string;

        if (!id) {
            // debug(`failed to get id for row ${row.rowNumber}`);
            return [null, null];
        }

        if (typeof id != "string") {
            // debug(`unexpected neuron id type ${row.rowNumber} ${id}`);
            return [null, null];
        }

        const parts = id.split("-");

        if (parts.length > 1) {
            const subjectId = parts[1].replace("*", "");

            if (!this.includeSubject(subjectId)) {
                return [null, null];
            }

            if (this._specimens.has(subjectId)) {
                return [parts[0], this._specimens.get(subjectId)];
            }

            if (this._pendingSpecimens.has(subjectId)) {
                const specimen = this._pendingSpecimens.get(subjectId);
                // The specimen was in pending b/c it was not marked for publish.  However, at least one child neuron is, so bump it to the "real" map.
                if (specimen) {
                    // Ensure it is generated.
                    // debug(`promoting ${specimen.subjectId} from pending`);
                    this._specimens.set(subjectId, specimen);
                    this._pendingSpecimens.delete(subjectId);
                    return [parts[0], specimen];
                }
            }
        }

        return [null, null];
    }

    private includeSubject(subjectId: string): boolean {
        if (subjectId == null) {
            return false;
        }

        if (specimenSubset.length > 0) {
            return specimenSubset.includes(subjectId);
        }

        return true;
    }

    private getCell(row: Row, name: ColumnName): Cell {
        return row.cells.find((r: any) => r.columnId == SmartSheetImport.columns[name]);
    }

    private getDisplayValue(row: Row, name: ColumnName): string {
        return this.getCell(row, name)?.displayValue ?? "";
    }

    private getStringValue(row: Row, name: ColumnName): string {
        return this.getCell(row, name)?.value ?? "";
    }

    private getNumberValue(row: Row, name: ColumnName): number {
        return parseFloat(this.getCell(row, name)?.value);
    }

    private getReconstructionStatus(row: Row, name: ColumnName = ColumnName.Status1): Status {
        const value = this.getStringValue(row, name);

        if (statusValues.includes(value as Status)) {
            return value as Status;
        }

        return null;
    }

    private getDateValue(row: Row, name: ColumnName): Date {
        const date = this.getStringValue(row, name);

        if (date) {
            const parsed = moment(date, "YYYY-MM-DD");
            if (parsed.isValid()) {
                return parsed.toDate();
            }
        }

        return null;
    }

    private findColumnIds(sheet: Sheet) {
        if (SmartSheetImport.columns.size > 0) {
            return;
        }

        const columNameValues = Object.values(ColumnName)

        sheet.columns.forEach((column) => {
            if (columNameValues.includes(column.title as ColumnName)) {
                SmartSheetImport.columns[column.title as ColumnName] = column.id;
            }
        });
    }

    private parseCoordinates(coordinates: string): { x: number, y: number, z: number } | null {
        if (!coordinates) {
            return null;
        }

        const parts = coordinates.replace(/[()[\]]/g, "").replace(/,/g, " ").split(/\s+/).map(s => s.trim());

        if (parts.length != 3) {
            return null;
        }

        const coords = parts.map(p => parseFloat(p));

        return coords.some(v => isNaN(v)) ? null : {x: coords[0], y: coords[1], z: coords[2]};
    }
}

const exaSPIMCollection = {
    name: "ExaSPIM"
}

const fMostCollection = {
    name: "fMOST"
}

async function populateDefaults(defaultUsers: DefaultUser[]): Promise<void> {
    await Collection.createOrUpdateForShape(User.SystemAutomationUser, exaSPIMCollection, true);
    await Collection.createOrUpdateForShape(User.SystemAutomationUser, fMostCollection, true);

    for (const defaultUser of defaultUsers) {
        const user = await User.findOrCreateUser(defaultUser.authId, defaultUser.firstName, defaultUser.lastName, defaultUser.email, User.SystemAutomationUser);
        await User.updatePermissions(user.id, defaultUser.permissions, User.SystemAutomationUser);
    }
}

// Pulls a `--name value` or `--name=value` flag out of the argument list, leaving the positional arguments intact.
function extractFlag(args: string[], name: string): string | null {
    for (let idx = 0; idx < args.length; idx++) {
        const arg = args[idx];

        if (arg === `--${name}`) {
            const value = args[idx + 1] ?? null;
            args.splice(idx, value === null ? 1 : 2);
            return value;
        }

        if (arg.startsWith(`--${name}=`)) {
            const value = arg.substring(name.length + 3);
            args.splice(idx, 1);
            return value;
        }
    }

    return null;
}

// Resolves a flag-provided path, exiting when an explicitly supplied path does not exist.  Falls back to the default when the flag is absent.
function resolvePathFlag(args: string[], name: string, defaultPath: string): string {
    const provided = extractFlag(args, name);

    if (provided === null) {
        return defaultPath;
    }

    if (!fs.existsSync(provided)) {
        console.error(`--${name} path "${provided}" does not exist.`);
        process.exit(-1);
    }

    return provided;
}

const cliArguments = process.argv.slice(2);

const usersPath = resolvePathFlag(cliArguments, "users", "./defaultUsers.json");

// Extracted up front to keep positional parsing clean, but its default location depends on reconstructionLocation resolved below.
const specimenMetadataFlag = extractFlag(cliArguments, "specimen-metadata");

if (specimenMetadataFlag !== null && !fs.existsSync(specimenMetadataFlag)) {
    console.error(`--specimen-metadata path "${specimenMetadataFlag}" does not exist.`);
    process.exit(-1);
}

if (cliArguments.length < 1 || isNaN(parseInt(cliArguments[0]))) {
    console.error("SmartSheet sheet numeric id required.");
    process.exit(-1);
}

let importQualifier = ImportQualifier.Test;
let reconstructionLocation: string = null;

if (cliArguments.length > 1) {
    const qualifier = parseInt(cliArguments[1]);
    if (!isNaN(qualifier)) {
        importQualifier = qualifier;
    }
}

if (cliArguments.length > 2 && cliArguments[2]) {
    if (fs.existsSync(cliArguments[2])) {
        reconstructionLocation = cliArguments[2];
    }
}

// Explicit flag wins; otherwise prefer specimenMetadata.json from the reconstruction location, falling back to the current directory.
let specimenMetadataPath = "./specimenMetadata.json";

if (specimenMetadataFlag !== null) {
    specimenMetadataPath = specimenMetadataFlag;
} else if (reconstructionLocation) {
    const candidate = path.join(reconstructionLocation, "specimenMetadata.json");
    if (fs.existsSync(candidate)) {
        specimenMetadataPath = candidate;
    }
}

type SpecimenMetadata = {
    subject: string;
    tomography: SpecimenTomography | null;
    referenceDataset: ReferenceDataset | null;
}

let defaultUsers: DefaultUser[] = [];
let specimenMetadata: SpecimenMetadata[] = [];

if (fs.existsSync(usersPath)) {
    const obj = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    defaultUsers = obj.users;
}

if (fs.existsSync(specimenMetadataPath)) {
    specimenMetadata = JSON.parse(fs.readFileSync(specimenMetadataPath, "utf8"));
}


const start = performance.now();

smartSheetImport(parseInt(cliArguments[0]), importQualifier, reconstructionLocation, defaultUsers).then(() => debug(`Import complete: ${((performance.now() - start) / 1000).toFixed(3)}s`));
