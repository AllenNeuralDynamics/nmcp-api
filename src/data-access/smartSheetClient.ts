import moment = require("moment");
import {BrainArea} from "../models/brainArea";
import {RemoteDatabaseClient} from "./remoteDatabaseClient";
import {Neuron, NeuronInput} from "../models/neuron";
import {Client, Sheet, Row, Cell, createClient} from "smartsheet";
import {Sample, SampleInput} from "../models/sample";
import {Collection} from "../models/collection";
import {User} from "../models/user";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import * as path from "path";
import * as fs from "fs";
import {Tracing} from "../models/tracing";

const debug = require("debug")("nmcp:api:smartsheet");

enum ColumnName {
    CCFCoordinates = "CCF Coordinates",
    HortaCoordinates = "Horta Coordinates",
    EstimatedSomaCompartment = "Manual Estimated Soma Compartment",
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
    Assigned = "Assigned"
}

enum Status {
    InProgress = "In Progress",
    Hold = "Hold",
    PendingReview = "Pending Review",
    Completed = "Completed",
    Incomplete = "Incomplete",
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
    brainStructureAcronym: string;
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

type ParsedNeuronIdWithSample = [string, SampleRowContents];

export const synchronize = async (sheetId: number = 0, pathToReconstructions: string = "", parseFiles: number = 1, accessToken: string = "") => {
    const token = accessToken || process.env.SS_API_TOKEN;

    if (!token) {
        debug("SmartSheet access token required.");
        return;
    }

    await RemoteDatabaseClient.Start(false, false);

    await BrainArea.loadCompartmentCache();

    const s = new SmartSheetClient(token);

    await s.parseSheet(sheetId);

    // s.print();

    await s.updateDatabase(pathToReconstructions, parseFiles != 0 && pathToReconstructions.length > 0);
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

    return null;
}

async function ensureUser(name: string, email: string) {
    if (name && email) {
        const names = name.split(" ");

        return await User.findOrCreateUser(null, names.length > 0 ? names[0] : "", names.length > 1 ? names[1] : "", email)
    }

    return null;
}

async function sampleFromRowContents(s: SampleRowContents, reconstructionLocation: string, parseFiles: boolean) {
    const sample = await Sample.findOrCreateForSubject(s.subjectId);

    const collection = await Collection.findByName(s.collectionName);

    if (!collection) {
        console.log(`no matching collection ${s.collectionName} for sample ${s.subjectId}`);
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
        let somaBrainStructure = BrainArea.getFromAcronym(n.brainStructureAcronym)?.id

        if (!somaBrainStructure) {
            somaBrainStructure = BrainArea.getFromName(n.brainStructureAcronym)?.id
        }

        if (!somaBrainStructure) {
            debug(`failed to look up soma brain structure for ${s.subjectId}-${n.idString}: ${n.brainStructureAcronym}`)
            return;
        }

        const neuron = await Neuron.findOrCreateWithIdString(n.idString, sample.id);

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

    await Promise.all(neuronsForReconstructions.map(async (n) => {
        const annotator1 = users.get(n.annotatorEmail);

        const annotator2 = users.get(n.annotator2Email);

        const annotator = annotator1 || annotator2;

        if (!annotator) {
            return;
        }

        const proofreader = n.proofreaderEmail ? users.get(n.proofreaderEmail) : null;

        if (!n.id) {
            // Earlier issue w/parsing - neuron not created.
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
            }

            if (!parseFiles) {
                return;
            }

            const file_prefix = `${n.idString}-${s.subjectId}`;

            const annotatorInitials = (u: User): string => {
                return `${u.firstName.length > 0 ? u.firstName[0] : ""}${u.lastName.length > 0 ? u.lastName[0] : ""}`.toUpperCase();
            };

            try {
                let jsonFile = `${file_prefix}-consensus.json`;
                let jsonPath = path.join(reconstructionLocation, jsonFile);

                if (!fs.existsSync(jsonPath)) {
                    jsonFile = `${file_prefix}-CONSENSUS.json`;
                    jsonPath = path.join(reconstructionLocation, jsonFile);

                    if (!fs.existsSync(jsonPath)) {
                        if (annotator1) {
                            jsonFile = `${file_prefix}-${annotatorInitials(annotator1)}.json`;
                            jsonPath = path.join(reconstructionLocation, jsonFile);
                        }

                        if (!fs.existsSync(jsonPath)) {
                            if (annotator2) {
                                jsonFile = `${file_prefix}-${annotatorInitials(annotator2)}.json`;
                                jsonPath = path.join(reconstructionLocation, jsonFile);
                            }

                            if (!fs.existsSync(jsonPath)) {
                                if (proofreader) {
                                    jsonFile = `${file_prefix}-${annotatorInitials(proofreader)}.json`;
                                    jsonPath = path.join(reconstructionLocation, jsonFile);
                                }
                            }
                        }
                    }
                }

                if (fs.existsSync(jsonPath)) {
                    const result = await Tracing.createTracingFromJson(reconstruction.id, jsonPath);

                    if (result.error) {
                        debug(`parsing error for ${jsonFile}`);
                        debug(`\t${result.error}`);
                    }
                } else if (reconstruction.status == ReconstructionStatus.Approved) {
                    debug(`expected reconstruction data not found for ${n.idString}-${s.subjectId}`);
                }
            } catch (err) {
                debug(`Issue detecting file for ${n.idString}-${s.subjectId}`);
            }
        } catch (error) {
            debug(error);
        }
    }));
}

export class SmartSheetClient {
    private static columns: Map<ColumnName, number> = new Map();

    private _client: Client;

    private samples: Map<string, SampleRowContents>;

    public constructor(token: string) {
        this._client = createClient({logLevel: "warn", accessToken: token});
    }

    public async parseSheet(sheetId: number) {
        try {
            const sheet: Sheet = await this._client.sheets.getSheet({id: sheetId});

            debug(`populating database with content from from "${sheet.name}"`);

            this.findColumnIds(sheet);

            this.samples = new Map();

            sheet.rows.forEach((row: any) => {
                let cell = this.getCell(row, ColumnName.Level);

                if (cell.value == 1) {
                    this.parseSample(row);
                } else {
                    this.parseNeuron(row);
                }
            });
        } catch (error) {
            console.log(error);
        }
    }

    public async updateDatabase(reconstructionLocation: string, parseFiles: boolean) {
        await Promise.all([...this.samples.values()].map(async (s) => {
            await sampleFromRowContents(s, reconstructionLocation, parseFiles);
        }));
    }

    public print() {
        this.samples.forEach(s => {
            if (s.neurons.length > 0) {
                console.log(s);
            }
        })
    }

    private parseSample(row: Row) {
        const subjectId = this.getDisplayValue(row, ColumnName.Id);
        const genotype = this.getStringValue(row, ColumnName.Genotype);
        const notes = this.getStringValue(row, ColumnName.Notes);
        const collectionName = this.getDisplayValue(row, ColumnName.Collection)

        const filename = this.getStringValue(row, ColumnName.DateStarted);

        let sampleDate: Date = null;

        if (filename) {
            const parsed = moment(filename, "YYYY-MM-DD");
            if (parsed.isValid()) {
                sampleDate = parsed.toDate();
            }
        }

        this.samples.set(subjectId, {
            subjectId,
            sampleDate,
            genotype,
            notes,
            collectionName,
            neurons: []
        });
    }

    private parseNeuron(row: any) {
        const ccf = this.getCell(row, ColumnName.CCFCoordinates).value as string;

        // Only processing rows that have a registered soma location.
        if (!ccf) {
            return;
        }

        // Ensure we can identify the sample.  This should just be the parent row, but this is a bit of a sanity
        // check that the neuron is named as we expect for other assumptions such as the reconstruction file name.
        const [id, sample] = this.getSampleFromId(row);

        if (!id) {
            return;
        }

        if (!sample) {
            debug(`failed to find sample for ${this.getStringValue(row, ColumnName.Id)} (row ${row.rowNumber})`);
            return;
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

        const ccfParts = ccf.replace("(", "").replace(")", "").split(" ").map((c: string) => parseFloat(c.replace(",", "")));

        const brainStructureAcronym = this.getStringValue(row, ColumnName.EstimatedSomaCompartment);

        const neuron: NeuronRowContents = {
            idString: id,
            x: ccfParts[0],
            y: ccfParts[1],
            z: ccfParts[2],
            sampleX: hortaParts[0],
            sampleY: hortaParts[1],
            sampleZ: hortaParts[2],
            brainStructureAcronym,
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
            console.log(`failed to get id for row ${row.rowNumber}`);
            return [null, null];
        }
        const parts = id.split("-");

        if (parts.length > 1) {
            const subjectId = parts[1].replace("*", "");

            if (subjectId) {
                return [parts[0], this.samples.get(subjectId)];
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
