import * as fs from "fs";
import {glob} from "glob";

import {Cell, Client, createClient, Row, Sheet} from "smartsheet";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {AtlasStructure} from "../models/atlasStructure";
import {Neuron, NeuronShape} from "../models/neuron";
import {Specimen, SpecimenShape} from "../models/specimen";
import {Collection} from "../models/collection";
import {User} from "../models/user";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {ReconstructionSpace} from "../models/reconstructionSpace";
import {Atlas} from "../models/atlas";
import {isNullOrEmpty} from "../util/objectUtil";
import moment = require("moment");

const debug = require("debug")("nmcp:api:smartsheet");

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
    sampleDate: Date;
    genotype: string;
    notes: string;
    collectionName: string;
    neurons: NeuronRowContents[];
}

type NeuronRowContents = {
    id?: string;
    idString: string;
    x: number;
    y: number;
    z: number;
    sampleX: number;
    sampleY: number
    sampleZ: number;
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

type ParsedNeuronIdWithSample = [string, SpecimenRowContents];

type DefaultUser = {
    authId: string;
    firstName: string;
    lastName: string;
    email: string;
    permissions: number
}

// Some ugly globals while we figure out what we want.
const reconstructionNotFound = [];
const ccfMissing = [];
const ccfCoordinatesParseFailed = [];
const ccfLookupFailed = [];
const failedToApprove = [];

const neuronSelection = {
    // "653159": ["N009", "N017"]
};

const specimenSubset = [...new Set(Object.keys(neuronSelection))];

if (specimenSubset.length > 0) {
    debug(`limiting specimens to ${specimenSubset.toString()}`);
}

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

        await populateDefaults(defaultUsers);

        const s = new SmartSheetImport(token);

        await s.parseSheet(sheetId, importQualifier);

        // If true, but insertReconstructions is false, will perform the transaction to insert to check for errors, but rollback the insert to leave tracing data
        // untouched.  This generally only changed to false in order to speed testing of other parts of the bulk sheet import process.
        const testFlightInsertion = true;

        await s.updateDatabase(pathToReconstructions, insertReconstructions, testFlightInsertion);

        s.print();

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

async function specimenDataFromRow(s: SpecimenRowContents, reconstructionLocation: string, insertReconstructions: boolean, testFlightInsertion: boolean = true) {
    const collection = await Collection.findByName(s.collectionName);

    if (!collection) {
        debug(`no matching collection ${s.collectionName} for specimen ${s.subjectId}`);
        return;
    }

    const shape: SpecimenShape = {
        label: s.subjectId,
        referenceDate: s.sampleDate,
        genotypeName: s.genotype,
        notes: s.notes,
        collectionId: collection.id
    };

    let specimen: Specimen;

    try {
        specimen = await Specimen.createOrUpdateForShape(shape, User.SystemAutomationUser, {allowCreate: true, allowMatchLabel: true});
    } catch (e) {
        debug(`error with createOrUpdateForShape for specimen ${s.subjectId}`)
        debug(e);
        return;
    }

    const suitableReconstructions: NeuronRowContents[] = [];

    for (const n of s.neurons) {
        if (neuronSelection[s.subjectId] !== undefined) {
            if (!neuronSelection[s.subjectId].includes(n.idString)) {
                debug("exempted");
                continue;
            }
        }

        let somaAtlasStructure = findBrainCompartment(specimen.getAtlas(), n.manualBrainStructureAcronym, n.ccfBrainStructureAcronym)?.id

        if (!somaAtlasStructure) {
            ccfLookupFailed.push({
                subject: s.subjectId,
                neuron: n.idString,
                manual: n.manualBrainStructureAcronym,
                ccf: n.ccfBrainStructureAcronym
            });
        }

        const assigned = n.assigned?.trim() ?? "";

        const shape: NeuronShape = {
            specimenId: specimen.id,
            label: n.idString,
            specimenSoma: {
                x: n.sampleX,
                y: n.sampleY,
                z: n.sampleZ,
            },
            atlasSoma: {
                x: n.x,
                y: n.y,
                z: n.z,
            },
            atlasStructureId: somaAtlasStructure,
            keywords: assigned.length > 0 ? [assigned] : []
        };

        try {
            const neuron = await Neuron.createOrUpdateForShape(shape, User.SystemAutomationUser, {allowCreate: true, allowMatchLabel: true});
            n.id = neuron.id;
            suitableReconstructions.push(n);
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
            // This tool assumes one instance of a reconstruction per annotator, per candidate.  If the information in SmartSheets is meant to allow a second
            // reconstruction for the same annotator on the same neuron/candidate, this must be changed.
            let reconstruction = await Reconstruction.findOrOpenReconstruction(n.id, annotator, User.SystemAutomationUser);

            // Do not modify a published, archived, or discards reconstruction.
            if (immutableReconstructionStatus.includes(reconstruction.status)) {
                debug(`${reconstruction.id} (${n.idString}-${s.subjectId}) skipped ${ReconstructionStatus[reconstruction.status]}.`)
                continue;
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
                    /*
                    reconstruction = await Reconstruction.approveReconstruction(reconstruction.id, ReconstructionStatus.Approved, proofreader ?? User.SystemAutomationUser, User.SystemAutomationUser, true);
                    if (reconstruction.status != ReconstructionStatus.Approved) {
                        failedToApprove.push(`${reconstruction.id} (${n.idString}-${s.subjectId})`);
                        debug(`failed to approve reconstruction ${reconstruction.id} (${n.idString}-${s.subjectId})`);
                        continue;
                    }
                    */
                    break;
                case ReconstructionStatus.Discarded:
                    await Reconstruction.discardReconstruction(reconstruction.id, annotator, User.SystemAutomationUser);
                    continue;
            }

            const file_prefix = `${n.idString}-${s.subjectId}`;

            try {
                const jsonPath = await locateReconstructionFile(reconstructionLocation, file_prefix);

                if (jsonPath) {
                    if (insertReconstructions || testFlightInsertion) {
                        debug(`\tupdating or adding reconstruction data for ${file_prefix}`)
                        try {
                            await Reconstruction.fromJsonFile(proofreader ?? User.SystemAutomationUser, reconstruction.id, jsonPath, ReconstructionSpace.Atlas, User.SystemAutomationUser);

                            if (targetStatus == ReconstructionStatus.Approved) {
                                reconstruction = await Reconstruction.approveReconstruction(reconstruction.id, ReconstructionStatus.Approved, proofreader ?? User.SystemAutomationUser, User.SystemAutomationUser, true);
                                if (reconstruction.status != ReconstructionStatus.WaitingForAtlasReconstruction) {
                                    failedToApprove.push(`${reconstruction.id} (${n.idString}-${s.subjectId})`);
                                    debug(`failed to approve reconstruction ${reconstruction.id} (${n.idString}-${s.subjectId})`);
                                }
                            }
                        } catch (error) {
                            debug(`\t---> parsing error for ${jsonPath}`);
                            debug(error);
                            debug(`\t---`);
                        }
                    }
                } else if (reconstruction.status == ReconstructionStatus.Approved) {
                    reconstructionNotFound.push({subject: s.subjectId, neuron: n.idString});
                    debug(`\t---> expected reconstruction data not found for ${file_prefix}`);
                } else {
                    debug(`\t---> failed to find reconstruction data for unexpected status: ${reconstruction.status} for: ${reconstruction.id} (${n.idString}-${s.subjectId}`);
                }
            } catch (err) {
                debug(`---> issue detecting file for ${file_prefix}`);
                console.log(err);
            }
        } catch (error) {
            debug(error);
        }
    }
}

async function locateReconstructionFile(baseLocation: string, file_prefix: string): Promise<string> {
    const sources = await glob(`${baseLocation}/**/${file_prefix}*.json`)

    return sources?.length > 0 ? sources[0] : null;
}

class SmartSheetImport {
    private static columns: Map<ColumnName, number> = new Map();

    private _client: Client;

    // Samples that will be used.
    private samples: Map<string, SpecimenRowContents>;

    // Samples that may be used if a neuron meets the requirements.  Primarily this is used for the production instance where a subset of neurons may be
    // marked for production and the parent sample is not.  Those samples linger here until or unless an associated neuron is marked to use.
    private pendingSamples: Map<string, SpecimenRowContents>;


    public constructor(token: string) {
        this._client = createClient({logLevel: "warn", accessToken: token});
    }

    public async parseSheet(sheetId: number, qualifier: ImportQualifier) {
        try {
            const sheet: Sheet = await this._client.sheets.getSheet({id: sheetId});

            debug(`populating database with content from from "${sheet.name}"`);

            this.findColumnIds(sheet);

            this.samples = new Map();
            this.pendingSamples = new Map();

            sheet.rows.forEach((row: any) => {
                let cell = this.getCell(row, ColumnName.Level);

                if (cell.value == 1) {
                    this.parseSample(row, qualifier);
                } else {
                    this.parseNeuron(row, qualifier);
                }
            });
        } catch (error) {
            console.log(error);
        }

        for (const s of this.samples.values()) {
            s.neurons = s.neurons.sort((a, b) => a.idString.localeCompare(b.idString));
        }
    }

    public async updateDatabase(reconstructionLocation: string, insertReconstructions: boolean, testFlightInsertion: boolean = true) {
        let ordered = Array.from(this.samples.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));

        if (specimenSubset.length > 0) {
            ordered = ordered.filter(o => specimenSubset.includes(o.subjectId));
        }

        for (const s of ordered) {
            await specimenDataFromRow(s, reconstructionLocation, insertReconstructions, testFlightInsertion);
        }
    }

    public print() {
        const showPending = false;

        let ordered = Array.from(this.samples.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
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
            ordered = Array.from(this.pendingSamples.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
            if (ordered.length > 0) {
                debug(`subjects stuck in pending:`);
                ordered.forEach(s => {
                    debug(`\t${s.subjectId}`);
                });
            }
        }

        if (reconstructionNotFound.length > 0) {
            debug("reconstruction marked approved, but data not found:")
            reconstructionNotFound.forEach(r => {
                debug(`\t${r.subject}-${r.neuron}`);
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
    }

    private parseSample(row: Row, qualifier: ImportQualifier) {
        const subjectId = this.getDisplayValue(row, ColumnName.Id);
        const genotype = this.getStringValue(row, ColumnName.Genotype);
        const notes = this.getStringValue(row, ColumnName.Notes);
        const collectionName = this.getDisplayValue(row, ColumnName.Collection)

        const sampleDate = this.getDateValue(row, ColumnName.DateStarted);

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

        const sampleRow = {
            subjectId,
            sampleDate,
            genotype,
            notes,
            collectionName,
            neurons: []
        };

        if (qualifier != ImportQualifier.All && cell?.value != true) {
            // debug(`pushing pending sample ${subjectId}`);
            this.pendingSamples.set(subjectId, sampleRow);
        } else {
            // debug(`pushing sample ${subjectId}`);
            this.samples.set(subjectId, sampleRow);
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

        // Ensure we can identify the sample.  This should just be the parent row, but this is a bit of a sanity
        // check that the neuron is named as we expect for other assumptions such as the reconstruction file name.
        const [id, sample] = this.getSampleFromId(row);

        if (!id) {
            return;
        }

        if (!sample) {
            // debug(`failed to find sample for ${this.getStringValue(row, ColumnName.Id)} (row ${row.rowNumber})`);
            return;
        }

        let ccf = this.getCell(row, ColumnName.CCFCoordinates).value as string;

        // Only processing rows that have a registered soma location.
        if (!ccf) {
            ccfMissing.push({subject: sample.subjectId, neuron: id});

            if (!allowMissingCCF) {
                return;
            }

            ccf = "[0.0, 0.0, 0,0]";
        }

        const horta = this.getCell(row, ColumnName.HortaCoordinates).value as string;

        let hortaParts = [0, 0, 0];

        if (horta) {
            try {
                const parts = horta.replace("[", "").replace("]", "").split(",").map((c: string) => parseFloat(c.replace(",", "")));
                if (parts.every(p => !isNaN(p))) {
                    hortaParts = parts
                }
            } catch {
            }
        }

        let ccfParts = ccf.replace("(", "").replace(")", "").split(" ").map((c: string) => parseFloat(c.replace(",", "")));

        if (ccfParts.some(p => isNaN(p))) {
            ccfParts = ccf.replace("[", "").replace("]", "").split(" ").map((c: string) => parseFloat(c.replace(",", "")));
        }

        if (ccfParts.some(p => isNaN(p))) {
            ccfCoordinatesParseFailed.push({subject: sample.subjectId, neuron: id});
            debug(`could not parse CCF coordinates ${this.getStringValue(row, ColumnName.Id)} (row ${row.rowNumber})`);
        }

        const manualBrainStructureAcronym = this.getStringValue(row, ColumnName.EstimatedSomaCompartment);
        const ccfBrainStructureAcronym = this.getStringValue(row, ColumnName.CcfSomaCompartment);

        const neuron: NeuronRowContents = {
            idString: id,
            x: ccfParts[0],
            y: ccfParts[1],
            z: ccfParts[2],
            sampleX: hortaParts[0],
            sampleY: hortaParts[1],
            sampleZ: hortaParts[2],
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

        sample.neurons.push(neuron);
    }

    private getSampleFromId(row: any): ParsedNeuronIdWithSample {
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

            if (subjectId) {
                if (this.samples.has(subjectId)) {
                    return [parts[0], this.samples.get(subjectId)];
                }
                if (this.pendingSamples.has(subjectId)) {
                    const sample = this.pendingSamples.get(subjectId);
                    // The sample was in pending b/c it was not marked for publish.  However, at least one child neuron is, so bump it to the "real" map.
                    if (sample) {
                        // Ensure it is generated.
                        // debug(`promoting ${sample.subjectId} from pending`);
                        this.samples.set(subjectId, sample);
                        this.pendingSamples.delete(subjectId);
                        return [parts[0], sample];
                    }
                }
            }
        }

        return [null, null];
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

if (process.argv.length < 3 || isNaN(parseInt(process.argv[2]))) {
    console.error("SmartSheet sheet numeric id required.");
    process.exit(-1);
}

let importQualifier = ImportQualifier.Test;
let reconstructionLocation: string = null;

if (process.argv.length > 3) {
    const qualifier = parseInt(process.argv[3]);
    if (!isNaN(qualifier)) {
        importQualifier = qualifier;
    }
}

if (process.argv.length > 4 && process.argv[4]) {
    if (process.argv[4]) {
        if (fs.existsSync(process.argv[4])) {
            reconstructionLocation = process.argv[4];
        }
    } else {
        console.error(`${process.argv[4]} is not readable.`);
        process.exit(-1);
    }
}

let defaultUsers: DefaultUser[] = [];

if (fs.existsSync("./defaultUsers.json")) {
    const obj = JSON.parse(fs.readFileSync("./defaultUsers.json", "utf8"));
    defaultUsers = obj.users;
}

const start = performance.now();

smartSheetImport(parseInt(process.argv[2]), importQualifier, reconstructionLocation, defaultUsers).then((count) => debug(`synchronize: ${((performance.now() - start) / 1000).toFixed(3)}s`));
