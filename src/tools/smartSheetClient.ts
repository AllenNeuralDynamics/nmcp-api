import moment = require("moment");
import {AtlasStructure} from "../models/atlasStructure";
import {RemoteDatabaseClient} from "../data-access/remoteDatabaseClient";
import {Neuron, NeuronInput} from "../models/neuron";
import {Cell, Client, createClient, Row, Sheet} from "smartsheet";
import {Sample, SampleInput} from "../models/sample";
import {Collection} from "../models/collection";
import {User} from "../models/user";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {Tracing} from "../models/tracing";
import {glob} from "glob";

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

enum Status {
    InProgress = "In Progress",
    Hold = "Hold",
    PendingReview = "Pending Review",
    Completed = "Completed",
    // Incomplete = "Incomplete",
    Untraceable = "Untraceable"
}

const statusValues = Object.values(Status);

type SampleRowContents = {
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
}

enum ImportQualifier {
    All = 0,
    Production = 1,
    Test = 2
}

type ParsedNeuronIdWithSample = [string, SampleRowContents];

// Some ugly globals while we figure out what we want.
const reconstructionNotFound = [];
const ccfMissing = [];
const ccfCoordinatesParseFailed = [];
const ccfLookupFailed = [];

// Should be an argument but testing for now.
const allowMissingCCF = true;

export const synchronize = async (sheetId: number = 0, pathToReconstructions: string = "", insertReconstructions: number = 1, inQualifier: ImportQualifier = ImportQualifier.Production, accessToken: string = "") => {
    const token = accessToken || process.env.SS_API_TOKEN;

    if (!token) {
        debug("SmartSheet access token required.");
        return;
    }

    let qualifier: ImportQualifier;

    if (typeof inQualifier === "string") {
        qualifier = parseInt(inQualifier) as ImportQualifier;
    } else {
        qualifier = inQualifier;
    }

    debug(`SmartSheet import from ${sheetId}. Import Qualifier: ${ImportQualifier[qualifier]}, Parse files: ${insertReconstructions != 0}`)

    await RemoteDatabaseClient.Start(false, false);

    await AtlasStructure.loadCompartmentCache("smartsheet import");

    const s = new SmartSheetClient(token);

    await s.parseSheet(sheetId, qualifier);

    // If true, but insertReconstructions is false, will perform the transaction to insert to check for errors, but rollback the insert to leave tracing data
    // untouched.  This generally only changed to false in order to speed testing of other parts of the bulk sheet import process.
    const testFlightInsertion = true;

    await s.updateDatabase(pathToReconstructions, insertReconstructions != 0 && pathToReconstructions.length > 0, testFlightInsertion);

    s.print();

    if (reconstructionNotFound.length > 0) {
        debug("Expected reconstruction data not found:")
        reconstructionNotFound.forEach(r => {
            debug(`\t${r.subject}-${r.neuron}`);
        });
    }

    if (ccfMissing.length > 0) {
        debug(`CCF soma coordinates missing ${allowMissingCCF ? "" : "(included due to allowMissingCCF = true)"}:`)
        ccfCoordinatesParseFailed.forEach(r => {
            debug(`\t${r.subject}-${r.neuron}`);
        });
    }

    if (ccfCoordinatesParseFailed.length > 0) {
        debug("Could not parse CCF soma coordinates:")
        ccfCoordinatesParseFailed.forEach(r => {
            debug(`\t${r.subject}-${r.neuron}`);
        });
    }

    if (ccfLookupFailed.length > 0) {
        debug("Failed to look up some brain compartment:")
        ccfLookupFailed.forEach(r => {
            debug(`\t${r.subject}-${r.neuron}`);
        });
    }
};

function isReadyToImport(status: Status): boolean {
    return status == Status.Completed || status == Status.PendingReview || status == Status.InProgress;
}

function reconstructionStatusForSmartSheetStatus(status: Status) {
    switch (status) {
        case Status.InProgress:
            return ReconstructionStatus.InProgress;
        case Status.Hold:
            return ReconstructionStatus.OnHold;
        case Status.PendingReview:
            return ReconstructionStatus.InReview;
        case Status.Completed:
            return ReconstructionStatus.Approved;
        case Status.Untraceable:
            return ReconstructionStatus.Invalid;
    }
}

async function ensureUser(name: string, email: string) {
    if (name && email) {
        let names = name.split(" ");

        // Special exception for AIND-specific smartsheet variation - this user dropdown entry does not have email value w/display name.
        if (email == "kevianna.adams@alleninstitute.org") {
            names = ["Kevianna", "Adams"];
        }

        return await User.findOrCreateUser(null, names.length > 0 ? names[0] : "", names.length > 1 ? names[1] : "", email)
    }

    return null;
}

function findBrainCompartmentSimple(label: string): AtlasStructure {
    let somaBrainStructure = AtlasStructure.getFromAcronym(label);

    const simplifiedName = label.replace(new RegExp(",", 'g'), "");

    if (!somaBrainStructure) {
        somaBrainStructure = AtlasStructure.getFromName(simplifiedName)
    }

    if (!somaBrainStructure) {
        somaBrainStructure = AtlasStructure.getFromSafeName(simplifiedName)
    }

    return somaBrainStructure;
}

function findBrainCompartment(primaryLabel: string, secondaryLabel: string): AtlasStructure {
    return findBrainCompartmentSimple(primaryLabel) ?? findBrainCompartmentSimple(secondaryLabel);
}

async function sampleFromRowContents(s: SampleRowContents, reconstructionLocation: string, insertReconstructions: boolean, testFlightInsertion: boolean = true) {
    const sample = await Sample.findOrCreateForSubject(s.subjectId);

    const collection = await Collection.findByName(s.collectionName);

    if (!collection) {
        debug(`no matching collection ${s.collectionName} for sample ${s.subjectId}`);
        return;
    }

    const input: SampleInput = {
        id: sample.id,
        animalId: s.subjectId,
        sampleDate: s.sampleDate?.valueOf(),
        mouseStrainName: s.genotype,
        tag: s.notes,
        collectionId: collection.id
    }

    await Sample.updateWith(input);

    await Promise.all(s.neurons.map(async (n) => {
        let somaBrainStructure = findBrainCompartment(n.manualBrainStructureAcronym, n.ccfBrainStructureAcronym)?.id

        if (!somaBrainStructure) {
            ccfLookupFailed.push({subject: s.subjectId, neuron: n.idString});
            debug(`failed to look up soma brain structure for ${s.subjectId}-${n.idString}:`);
            debug(`\tmanual estimated: ${n.manualBrainStructureAcronym.replace(new RegExp(",", 'g'), "")}`);
            debug(`\tccf: ${n.ccfBrainStructureAcronym.replace(new RegExp(",", 'g'), "")}`);
            // return;
        }

        let neuron = null;

        try {
            neuron = await Neuron.findOrCreateWithIdString(n.idString, sample.id);
        } catch (e) {
            debug(`error with findOrCreateWithIdString for neuron ${n.idString} (sample ${s.subjectId})`)
            return
        }

        n.id = neuron.id;

        const input: NeuronInput = {
            id: n.id,
            x: n.x,
            y: n.y,
            z: n.z,
            sampleX: n.sampleX,
            sampleY: n.sampleY,
            sampleZ: n.sampleZ,
            brainStructureId: somaBrainStructure,
            tag: n.assigned?.trim() ?? ""
        };

        // debug(`updating neuron ${n.idString} (sample ${sample.animalId})`)

        await Neuron.updateWith(input);
    }));

    const neuronsForReconstructions = s.neurons.filter(n => isReadyToImport(n.status));

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
            return;
        }

        const annotator1 = users.get(n.annotatorEmail);

        const annotator2 = users.get(n.annotator2Email);

        const annotator = annotator1 || annotator2;

        if (!annotator) {
            debug(`neuron ${n.idString}-${s.subjectId} is missing annotator - skipped`)
            return;
        }

        try {
            let reconstruction = await Reconstruction.findOne({
                where: {
                    annotatorId: annotator.id,
                    neuronId: n.id
                }
            });

            const updateStatus = reconstructionStatusForSmartSheetStatus(n.status);

            if (reconstruction) {
                // TODO This will overwrite any manual changes make in the portal - is this ok?
                const updates = {
                    notes: n.notes,
                    checks: n.checks,
                    durationHours: isNaN(n.duration) ? 0 : n.duration,
                    lengthMillimeters: isNaN(n.length) ? 0 : n.length,
                };

                // Can only override certain status values.
                if (reconstruction.status == ReconstructionStatus.InReview || reconstruction.status == ReconstructionStatus.OnHold || reconstruction.status == ReconstructionStatus.InProgress) {
                    updates["status"] = updateStatus;
                }

                // debug(`updating reconstruction ${reconstruction.id} (${n.idString}-${s.subjectId})`)

                await reconstruction.update(updates);
            } else {
                reconstruction = await Reconstruction.create({
                    neuronId: n.id,
                    annotatorId: annotator.id,
                    status: updateStatus,
                    notes: n.notes,
                    checks: n.checks,
                    durationHours: isNaN(n.duration) ? 0 : n.duration,
                    lengthMillimeters: isNaN(n.length) ? 0 : n.length,
                    startedAt: null
                });

                // debug(`created reconstruction ${reconstruction.id} (${n.idString}-${s.subjectId})`)
            }

            // Do not replace tracing if already published.
            if (reconstruction.status >= ReconstructionStatus.PendingStructureAssignment) {
                debug(`updating reconstruction ${reconstruction.id} (${n.idString}-${s.subjectId}) is already published or pending publication.`)
                continue;
            }

            const file_prefix = `${n.idString}-${s.subjectId}`;

            try {
                const jsonPath = await locateReconstructionFile(reconstructionLocation, file_prefix);

                if (jsonPath) {
                    if (insertReconstructions || testFlightInsertion) {
                        debug(`\tupdating or adding reconstruction data for ${file_prefix}`)
                        const result = await Tracing.createTracingFromJson(reconstruction.id, jsonPath, insertReconstructions);

                        if (result.error) {
                            debug(`\t---> parsing error for ${jsonPath}`);
                            debug(`\t---> ${result.error}`);
                        }
                    }
                } else if (reconstruction.status == ReconstructionStatus.Approved) {
                    reconstructionNotFound.push({subject: s.subjectId, neuron: n.idString});
                    debug(`\t---> expected reconstruction data not found for ${file_prefix}`);
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

export class SmartSheetClient {
    private static columns: Map<ColumnName, number> = new Map();

    private _client: Client;

    // Samples that will be used.
    private samples: Map<string, SampleRowContents>;

    // Samples that may be used if a neuron meets the requirements.  Primarily this is used for the production instance where a subset of neurons may be
    // marked for production and the parent sample is not.  Those samples linger here until or unless an associated neuron is marked to use.
    private pendingSamples: Map<string, SampleRowContents>;


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
        const ordered = Array.from(this.samples.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));

        for (const s of ordered) {
            await sampleFromRowContents(s, reconstructionLocation, insertReconstructions, testFlightInsertion);
        }
    }

    public print() {
        const showPending = false;

        let ordered = Array.from(this.samples.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
        debug(`subjects with imports:`);
        ordered.forEach(s => {
            if (s.neurons.length > 0) {
                debug(`\t${s.subjectId} imported with ${s.neurons.length} neuron(s)`);
            }
        });

        let shown = false;
        debug(`subjects with expected imports that are missing:`);
        ordered.forEach(s => {
            if (s.neurons.length == 0) {
                debug(`\t${s.subjectId}`);
                shown = true;
            }
        });

        if (!shown) {
            debug("\tnone");
        }

        if (showPending) {
            ordered = Array.from(this.pendingSamples.values()).sort((a, b) => a.subjectId.localeCompare(b.subjectId));
            debug(`subjects stuck in pending:`);
            ordered.forEach(s => {
                debug(`\t${s.subjectId}`);
            });
        }
    }

    private parseSample(row: Row, qualifier: ImportQualifier) {
        const subjectId = this.getDisplayValue(row, ColumnName.Id);
        const genotype = this.getStringValue(row, ColumnName.Genotype);
        const notes = this.getStringValue(row, ColumnName.Notes);
        const collectionName = this.getDisplayValue(row, ColumnName.Collection)

        const filename = this.getStringValue(row, ColumnName.DateStarted);

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

        let sampleDate: Date = null;

        if (filename) {
            const parsed = moment(filename, "YYYY-MM-DD");
            if (parsed.isValid()) {
                sampleDate = parsed.toDate();
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
            assigned: this.getStringValue(row, ColumnName.Assigned)
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
        return row.cells.find((r: any) => r.columnId == SmartSheetClient.columns[name]);
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

    private findColumnIds(sheet: Sheet) {
        if (SmartSheetClient.columns.size > 0) {
            return;
        }

        const columNameValues = Object.values(ColumnName)

        sheet.columns.forEach((column) => {
            if (columNameValues.includes(column.title as ColumnName)) {
                SmartSheetClient.columns[column.title as ColumnName] = column.id;
            }
        });
    }
}
