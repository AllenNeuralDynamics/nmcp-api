// One-off repair of registered reconstruction DOIs and their neurons' canonical DOIs: collapses the f3963af doubled
// slash in DataCite URLs, mints missing canonicals, makes the IsVersionOf/HasVersion relationships exact, and syncs
// SearchIndex.canonicalDoi.  Delete this tool once every deployment has been repaired.
//
//   node src/tools/fixReconstructionDois.js [--apply] [--neuron <neuronId>] [--interval-ms <milliseconds>] | tee run.log
//
// Without --apply it is a dry run: DataCite GETs only, over a read-only database session.

import * as path from "path";
import * as fs from "fs";
import {Op, Options, QueryTypes, Sequelize} from "sequelize";

import {DataCiteRelatedIdentifier, DataCiteService, DataCiteServiceStatus} from "../data-access/doi/dataCiteService";
import {CoreServiceOptions, SequelizeOptions} from "../options/coreServicesOptions";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {Reconstruction} from "../models/reconstruction";
import {CanonicalDoiResult, Neuron} from "../models/neuron";
import {SearchIndex} from "../models/searchIndex";
import {User} from "../models/user";

const usage = "usage: node src/tools/fixReconstructionDois.js [--apply] [--neuron <neuronId>] [--interval-ms <milliseconds>]";

// Module-private in user.ts.
const SystemInternalId = "019a7d99-202b-7000-8000-000000000010";

// Stands in for the canonical a dry run would mint; it matches no real DOI, so every relationship naming it is reported.
const pendingCanonical = "(canonical to be minted)";

const options = CoreServiceOptions.rest.doiGeneration;

type ToolArguments = {
    apply: boolean;
    neuronId: string | null;
    intervalMs: number;
}

type ScannedRow = {
    atlasReconstructionId: string;
    reconstructionId: string;
    doi: string;
    deleted: boolean;
}

type NeuronGroup = {
    neuronId: string;
    label: string;
    canonicalDoi: string | null;
    deleted: boolean;
    rows: ScannedRow[];
}

type DoiOccurrence = {
    role: "canonical" | "reconstruction";
    doi: string;
    neuronId: string | null;
    atlasReconstructionId: string | null;
    orphaned: boolean;
}

type FetchedRecord = {
    url: string;
    relatedIdentifiers: DataCiteRelatedIdentifier[];
    publicationYear: number | null;
}

type RelationshipChange = {
    desired: DataCiteRelatedIdentifier[];
    added: DataCiteRelatedIdentifier[];
    replaced: { previous: DataCiteRelatedIdentifier, replacement: DataCiteRelatedIdentifier }[];
    removed: DataCiteRelatedIdentifier[];
}

type DoiKind = "canonical" | "reconstruction";

type Failure = {
    neuronId: string;
    doi: string | null;
    step: string;
    error: string;
}

type Mismatch = {
    kind: DoiKind;
    doi: string;
    neuron: string;
    reconstructionId: string | null;
    registeredUrl: string;
    expectedUrl: string;
}

type NeuronContext = {
    group: NeuronGroup;
    step: string;
    actions: number;
    failed: boolean;
    syncTarget: string | null;
    minting: boolean;
    mintedDoi: string | null;
}

let apply = false;
let intervalMs = 500;
let lastCallAt = 0;
let systemInternalUser: User = null;

const counts = {
    neuronsScanned: 0,
    neuronsSkipped: 0,
    neuronsFailed: 0,
    neuronsExempt: 0,
    rowsOrphaned: 0,
    doisFetched: 0,
    doisOutOfPrefix: 0,
    doisUnchanged: 0,
    urlsFixed: 0,
    canonicalsMinted: 0,
    entriesAdded: 0,
    entriesReplaced: 0,
    entriesRemoved: 0,
    listsRewritten: 0,
    searchIndexRows: 0,
    mismatches: 0
};

const failures: Failure[] = [];
const mismatches: Mismatch[] = [];
const exemptNeurons: NeuronGroup[] = [];

// Pulls a `--name value` or `--name=value` flag out of the argument list.  A flag given without a value yields "".
function extractFlag(args: string[], name: string): string | null {
    for (let idx = 0; idx < args.length; idx++) {
        const arg = args[idx];

        if (arg === `--${name}`) {
            const next = args[idx + 1];
            const value = next === undefined || next.startsWith("--") ? "" : next;
            args.splice(idx, value === "" ? 1 : 2);
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

function parseArguments(): ToolArguments | null {
    const args = process.argv.slice(2);

    let applyFlag = false;

    for (let idx = args.indexOf("--apply"); idx >= 0; idx = args.indexOf("--apply")) {
        applyFlag = true;
        args.splice(idx, 1);
    }

    const neuronId = extractFlag(args, "neuron");
    const interval = extractFlag(args, "interval-ms");

    if (args.length > 0 || neuronId === "" || (interval !== null && !/^\d+$/.test(interval))) {
        return null;
    }

    const intervalValue = interval === null ? 500 : parseInt(interval, 10);

    if (intervalValue <= 0) {
        return null;
    }

    return {apply: applyFlag, neuronId, intervalMs: intervalValue};
}

function normalizeDoi(doi: string): string {
    return doi.trim().toLowerCase();
}

function inPrefix(doi: string): boolean {
    return normalizeDoi(doi).startsWith(`${options.prefix.trim().toLowerCase()}/`);
}

function sameDoi(left: string | null | undefined, right: string | null | undefined): boolean {
    if (typeof left !== "string" || typeof right !== "string") {
        return false;
    }

    return normalizeDoi(left) === normalizeDoi(right);
}

// Anchored to the host so the scheme's "//" and anything later in the path are never touched.
function collapseDoubledSlash(url: string): string {
    return url.replace(/^(https?:\/\/[^/]+)\/\/neuron\//, "$1/neuron/");
}

function expectedReconstructionUrl(neuronId: string, reconstructionId: string): string {
    return `${options.url}neuron/${neuronId}/${reconstructionId}`;
}

function expectedCanonicalUrl(neuronId: string): string {
    return `${options.url}neuron/${neuronId}`;
}

function versionEntry(relationType: "IsVersionOf" | "HasVersion", doi: string): DataCiteRelatedIdentifier {
    return {
        relatedIdentifierType: "DOI" as const,
        relationType,
        relatedIdentifier: doi,
        resourceTypeGeneral: "Dataset"
    };
}

function isExactVersionEntry(entry: DataCiteRelatedIdentifier, relationType: string, targetDoi: string): boolean {
    return entry.relationType === relationType
        && sameDoi(entry.relatedIdentifier, targetDoi)
        && entry.relatedIdentifierType === "DOI"
        && entry.resourceTypeGeneral === "Dataset";
}

function reconstructionRelationshipChange(existing: DataCiteRelatedIdentifier[], canonicalDoi: string): RelationshipChange | null {
    const versions = existing.filter(entry => entry.relationType === "IsVersionOf");
    const others = existing.filter(entry => entry.relationType !== "IsVersionOf");

    const exact = versions.find(entry => isExactVersionEntry(entry, "IsVersionOf", canonicalDoi));

    if (versions.length === 1 && exact) {
        return null;
    }

    if (exact) {
        return {desired: [...others, exact], added: [], replaced: [], removed: versions.filter(entry => entry !== exact)};
    }

    const fresh = versionEntry("IsVersionOf", canonicalDoi);

    if (versions.length === 0) {
        return {desired: [...others, fresh], added: [fresh], replaced: [], removed: []};
    }

    return {
        desired: [...others, fresh],
        added: [],
        replaced: [{previous: versions[0], replacement: fresh}],
        removed: versions.slice(1)
    };
}

// `held` must be distinct DOIs in row createdAt order, excluding the canonical itself.
function canonicalRelationshipChange(existing: DataCiteRelatedIdentifier[], held: string[]): RelationshipChange | null {
    const versions = existing.filter(entry => entry.relationType === "HasVersion");
    const others = existing.filter(entry => entry.relationType !== "HasVersion");

    const heldByKey = new Map<string, string>(held.map(doi => [normalizeDoi(doi), doi]));

    const firstExact = new Map<string, DataCiteRelatedIdentifier>();

    for (const entry of versions) {
        if (typeof entry.relatedIdentifier !== "string") {
            continue;
        }

        const key = normalizeDoi(entry.relatedIdentifier);

        if (heldByKey.has(key) && !firstExact.has(key) && isExactVersionEntry(entry, "HasVersion", heldByKey.get(key))) {
            firstExact.set(key, entry);
        }
    }

    const settled = new Set<string>();
    const kept: DataCiteRelatedIdentifier[] = [];
    const replaced: RelationshipChange["replaced"] = [];
    const removed: DataCiteRelatedIdentifier[] = [];

    for (const entry of versions) {
        const key = typeof entry.relatedIdentifier === "string" ? normalizeDoi(entry.relatedIdentifier) : null;

        if (key === null || !heldByKey.has(key) || settled.has(key)) {
            removed.push(entry);
            continue;
        }

        const exact = firstExact.get(key);

        if (exact) {
            if (entry === exact) {
                kept.push(entry);
                settled.add(key);
            } else {
                removed.push(entry);
            }
            continue;
        }

        const replacement = versionEntry("HasVersion", heldByKey.get(key));

        kept.push(replacement);
        replaced.push({previous: entry, replacement});
        settled.add(key);
    }

    const added = held.filter(doi => !settled.has(normalizeDoi(doi))).map(doi => versionEntry("HasVersion", doi));

    if (added.length === 0 && replaced.length === 0 && removed.length === 0) {
        return null;
    }

    return {desired: [...others, ...kept, ...added], added, replaced, removed};
}

// Escapes characters that would otherwise break a markdown table cell.
function escapeTableCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function describeEntry(entry: DataCiteRelatedIdentifier): string {
    return `${entry.relationType} ${entry.relatedIdentifier} [${entry.relatedIdentifierType}, ${entry.resourceTypeGeneral}]`;
}

function describeResult(result: { serviceStatus: DataCiteServiceStatus, serviceError: string | null }): string {
    return `${DataCiteServiceStatus[result.serviceStatus]} ${result.serviceError ?? ""}`.trim();
}

function errorMessage(err: any): string {
    return err?.message ?? `${err}`;
}

async function paced<T>(call: () => Promise<T>): Promise<T> {
    const wait = lastCallAt + intervalMs - Date.now();

    if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait));
    }

    lastCallAt = Date.now();

    return await call();
}

function parsePublicationYear(value: unknown): number | null {
    const year = typeof value === "string" && /^\d+$/.test(value) ? parseInt(value, 10) : value;

    return typeof year === "number" && Number.isInteger(year) ? year : null;
}

async function fetchRecord(doi: string): Promise<{ record: FetchedRecord, error: null } | { record: null, error: string }> {
    const result = await paced(() => DataCiteService.getDoi(doi));

    if (result.serviceStatus !== DataCiteServiceStatus.Success) {
        return {record: null, error: describeResult(result)};
    }

    const attributes = result.response?.data?.attributes;

    return {
        record: {
            url: attributes?.url ?? "",
            relatedIdentifiers: attributes?.relatedIdentifiers ?? [],
            publicationYear: parsePublicationYear(attributes?.publicationYear)
        },
        error: null
    };
}

function loadModels(sequelize: Sequelize): void {
    const location = path.normalize(path.join(__dirname, "..", "models"));

    const modules: any[] = fs.readdirSync(location).filter(file => file.endsWith(".js")).map(file => require(path.join(location, file.slice(0, -3))));

    for (const loaded of modules.filter(candidate => candidate.modelInit)) {
        loaded.modelInit(sequelize);
    }

    for (const loaded of modules) {
        if (loaded.modelAssociate != null) {
            loaded.modelAssociate();
        }
    }
}

// Not RemoteDatabaseClient.Start: its user cache and its seeding both write, and neither belongs in this tool.
async function connectDatabase(applying: boolean): Promise<Sequelize> {
    const connectionOptions: Options = {...SequelizeOptions};

    if (!applying) {
        // Passed by pg on every pooled connection, so Postgres itself refuses any write a dry run attempts.
        connectionOptions.dialectOptions = {options: "-c default_transaction_read_only=on"};
    }

    const sequelize = new Sequelize(connectionOptions.database, connectionOptions.username, connectionOptions.password, connectionOptions);

    loadModels(sequelize);

    await sequelize.authenticate();

    if (!applying) {
        const rows = await sequelize.query<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only", {type: QueryTypes.SELECT});

        if (rows[0]?.default_transaction_read_only !== "on") {
            throw new Error(`database session is not read-only (default_transaction_read_only = ${rows[0]?.default_transaction_read_only})`);
        }
    }

    return sequelize;
}

function printBanner(args: ToolArguments): void {
    console.log(`fixReconstructionDois: ${args.apply ? "APPLY" : "DRY RUN (no writes)"}`);
    console.log(`  DataCite: https://${options.host}:${options.port}${options.endpoint}, prefix ${options.prefix}, user ${options.user}`);
    console.log(`  Portal URL base: ${options.url}`);
    console.log(`  Database: ${SequelizeOptions.host}:${SequelizeOptions.port}/${SequelizeOptions.database}, session ${args.apply ? "read-write" : "read-only"}`);
    console.log(`  Pacing: ${args.intervalMs} ms between DataCite calls`);
    console.log(`  Scope: ${args.neuronId ? `neuron ${args.neuronId}` : "all neurons"}`);
    console.log("");
}

async function loadGroups(): Promise<{ groups: Map<string, NeuronGroup>, occurrences: DoiOccurrence[] }> {
    const scanned = await AtlasReconstruction.findAll({
        where: {doi: {[Op.and]: [{[Op.not]: null}, {[Op.ne]: ""}]}},
        attributes: ["id", "doi", "reconstructionId", "createdAt", "deletedAt"],
        include: [{
            model: Reconstruction,
            attributes: ["id", "neuronId", "deletedAt"],
            paranoid: false,
            include: [{model: Neuron, as: "Neuron", attributes: ["id", "label", "canonicalDoi", "deletedAt"], paranoid: false}]
        }],
        paranoid: false,
        order: [["createdAt", "ASC"]]
    });

    const groups = new Map<string, NeuronGroup>();
    const occurrences: DoiOccurrence[] = [];

    for (const child of scanned) {
        const doi = child.doi.trim();
        const reconstruction = child.Reconstruction;
        const neuron = reconstruction?.Neuron;

        if (inPrefix(doi)) {
            occurrences.push({
                role: "reconstruction",
                doi,
                neuronId: reconstruction?.neuronId ?? null,
                atlasReconstructionId: child.id,
                orphaned: !neuron
            });
        }

        if (!neuron) {
            console.log(`orphaned: atlas reconstruction ${child.id} (doi ${doi}) has no ${reconstruction ? "neuron" : "reconstruction"}; skipped`);
            counts.rowsOrphaned++;
            continue;
        }

        let group = groups.get(neuron.id);

        if (!group) {
            const canonicalDoi = neuron.canonicalDoi?.trim() || null;

            group = {neuronId: neuron.id, label: neuron.label, canonicalDoi, deleted: neuron.isSoftDeleted(), rows: []};
            groups.set(neuron.id, group);
        }

        group.rows.push({
            atlasReconstructionId: child.id,
            reconstructionId: child.reconstructionId,
            doi,
            deleted: child.isSoftDeleted() || reconstruction.isSoftDeleted()
        });
    }

    const canonicals = await Neuron.findAll({
        where: {canonicalDoi: {[Op.and]: [{[Op.not]: null}, {[Op.ne]: ""}]}},
        attributes: ["id", "canonicalDoi"],
        paranoid: false
    });

    for (const neuron of canonicals) {
        const doi = neuron.canonicalDoi.trim();

        if (inPrefix(doi)) {
            occurrences.push({role: "canonical", doi, neuronId: neuron.id, atlasReconstructionId: null, orphaned: false});
        }
    }

    return {groups, occurrences};
}

// Every later rule assumes each in-prefix DOI has a single owner: a canonical's HasVersion list is rebuilt from one
// neuron's rows, so a canonical shared between neurons would lose the other neuron's entries.
function checkOwnership(occurrences: DoiOccurrence[]): boolean {
    const byDoi = new Map<string, DoiOccurrence[]>();

    for (const occurrence of occurrences) {
        const key = normalizeDoi(occurrence.doi);
        const list = byDoi.get(key) ?? [];

        list.push(occurrence);
        byDoi.set(key, list);
    }

    const offending: DoiOccurrence[][] = [];

    for (const list of byDoi.values()) {
        const reconstructions = list.filter(occurrence => occurrence.role === "reconstruction");
        const canonicals = list.filter(occurrence => occurrence.role === "canonical");

        const crossOwned = canonicals.length === 1 && reconstructions.some(occurrence => occurrence.orphaned || occurrence.neuronId !== canonicals[0].neuronId);

        if (reconstructions.length > 1 || canonicals.length > 1 || crossOwned) {
            offending.push(list);
        }
    }

    if (offending.length === 0) {
        return true;
    }

    console.error("Stopping: these DOIs have more than one owner in the database, and need a human:");

    for (const list of offending) {
        console.error(`  ${list[0].doi}`);

        for (const occurrence of list) {
            const owner = occurrence.orphaned ? "orphaned row" : `neuron ${occurrence.neuronId}`;
            const child = occurrence.atlasReconstructionId ? `, atlas reconstruction ${occurrence.atlasReconstructionId}` : "";

            console.error(`    ${occurrence.role} of ${owner}${child}`);
        }
    }

    return false;
}

function recordFailure(context: NeuronContext, doi: string | null, error: string): void {
    failures.push({neuronId: context.group.neuronId, doi, step: context.step, error});

    context.failed = true;

    console.log(`    FAILED ${context.step}${doi ? ` ${doi}` : ""}: ${error}`);
}

function logAction(context: NeuronContext, message: string): void {
    context.actions++;

    console.log(`    ${message}`);
}

function would(pastTense: string, present: string): string {
    return apply ? pastTense : `would ${present}`;
}

async function fixUrl(context: NeuronContext, kind: DoiKind, doi: string, record: FetchedRecord, expected: string, reconstructionId: string | null, changed: Set<string>): Promise<void> {
    context.step = "url";

    const corrected = collapseDoubledSlash(record.url);

    if (corrected !== record.url) {
        changed.add(doi);
        logAction(context, `${kind} ${doi}: ${would("fixed", "fix")} url ${record.url} -> ${corrected}`);

        if (apply) {
            const result = await paced(() => DataCiteService.updateDoiUrl(doi, corrected));

            if (result.serviceStatus !== DataCiteServiceStatus.Success) {
                recordFailure(context, doi, describeResult(result));
            } else {
                counts.urlsFixed++;
            }
        } else {
            counts.urlsFixed++;
        }
    }

    // Compares the corrected string rather than a re-read, so a dry run and an apply report the same table.
    if (corrected !== expected) {
        console.log(`    ${kind} ${doi}: registered url ${corrected || "(empty)"} differs from expected ${expected} (reported, not corrected)`);

        counts.mismatches++;

        mismatches.push({
            kind,
            doi,
            neuron: `${context.group.label} (${context.group.neuronId})`,
            reconstructionId,
            registeredUrl: corrected,
            expectedUrl: expected
        });
    }
}

async function writeRelationships(context: NeuronContext, kind: DoiKind, doi: string, change: RelationshipChange, changed: Set<string>): Promise<void> {
    changed.add(doi);

    logAction(context, `${kind} ${doi}: ${would("rewrote", "rewrite")} relatedIdentifiers (${change.added.length} added, ${change.replaced.length} replaced, ${change.removed.length} removed)`);

    for (const entry of change.added) {
        console.log(`      + ${describeEntry(entry)}`);
    }

    for (const swap of change.replaced) {
        console.log(`      ~ ${describeEntry(swap.previous)} -> ${describeEntry(swap.replacement)}`);
    }

    for (const entry of change.removed) {
        console.log(`      - ${describeEntry(entry)}`);
    }

    if (apply) {
        const result = await paced(() => DataCiteService.updateDoi(doi, change.desired));

        if (result.serviceStatus !== DataCiteServiceStatus.Success) {
            recordFailure(context, doi, describeResult(result));
            return;
        }
    }

    counts.entriesAdded += change.added.length;
    counts.entriesReplaced += change.replaced.length;
    counts.entriesRemoved += change.removed.length;
    counts.listsRewritten++;
}

async function mintCanonical(context: NeuronContext, publicationYear: number, hasVersionEntries: DataCiteRelatedIdentifier[]): Promise<CanonicalDoiResult> {
    const group = context.group;

    // The transaction holds only the re-read and the mint, so a failed commit is the only way to lose the DOI.  No row
    // lock: the synchronization pipeline must be idle while this tool runs.
    return await Neuron.sequelize.transaction(async (t) => {
        const neuron = await Neuron.findByPk(group.neuronId, {transaction: t});

        if (!neuron) {
            throw new Error("neuron no longer exists");
        }

        // assignCanonicalDoi would return an existing canonical as if it had just been minted.
        if (neuron.canonicalDoi) {
            throw new Error(`neuron gained canonical ${neuron.canonicalDoi} since the scan; is the pipeline running?`);
        }

        const result = await paced(() => neuron.assignCanonicalDoi(systemInternalUser, publicationYear, hasVersionEntries, t));

        if (result.serviceStatus === DataCiteServiceStatus.Success) {
            context.mintedDoi = result.doi;

            // Printed before the commit: if the commit fails this line is the only trace of the registered DOI.
            console.log(`    canonical registered: ${result.doi} (committing)`);
        }

        return result;
    });
}

async function processDataCite(context: NeuronContext): Promise<void> {
    const group = context.group;

    context.step = "classify";

    const inPrefixRows = group.rows.filter(row => inPrefix(row.doi));
    const outOfPrefixRows = group.rows.filter(row => !inPrefix(row.doi));

    if (inPrefixRows.length === 0) {
        console.log("    skipped: no reconstruction DOI under this deployment's prefix");
        counts.neuronsSkipped++;
        counts.doisOutOfPrefix += outOfPrefixRows.length;
        return;
    }

    if (group.canonicalDoi && group.rows.some(row => sameDoi(row.doi, group.canonicalDoi))) {
        console.log(`    skipped: canonical ${group.canonicalDoi} is also a reconstruction DOI of this neuron; needs a human`);
        counts.neuronsSkipped++;
        return;
    }

    for (const row of outOfPrefixRows) {
        console.log(`    reconstruction ${row.doi}: not under prefix, skipped`);
        counts.doisOutOfPrefix++;
    }

    const held: string[] = [];

    for (const row of group.rows) {
        if (!sameDoi(row.doi, group.canonicalDoi) && !held.some(doi => sameDoi(doi, row.doi))) {
            held.push(row.doi);
        }
    }

    const canonicalInPrefix = group.canonicalDoi !== null && inPrefix(group.canonicalDoi);
    const needsMint = group.canonicalDoi === null && !group.deleted;

    // Listed before any fetch, so a failed GET cannot hide the neuron from the exempt section.
    if (group.canonicalDoi === null && group.deleted) {
        console.log("    exempt: deleted neuron without a canonical; none minted");
        counts.neuronsExempt++;
        exemptNeurons.push(group);
    }

    context.step = "fetch";

    let canonicalRecord: FetchedRecord = null;
    const rowRecords: { row: ScannedRow, record: FetchedRecord }[] = [];
    let fetchFailed = false;

    if (canonicalInPrefix) {
        console.log(`    GET canonical ${group.canonicalDoi}`);

        const fetched = await fetchRecord(group.canonicalDoi);

        if (fetched.error !== null) {
            recordFailure(context, group.canonicalDoi, `GET failed: ${fetched.error}`);
            fetchFailed = true;
        } else {
            canonicalRecord = fetched.record;
            counts.doisFetched++;
        }
    }

    for (const row of inPrefixRows) {
        console.log(`    GET reconstruction ${row.doi}${row.deleted ? " (deleted)" : ""}`);

        const fetched = await fetchRecord(row.doi);

        if (fetched.error !== null) {
            recordFailure(context, row.doi, `GET failed: ${fetched.error}`);
            fetchFailed = true;
            continue;
        }

        counts.doisFetched++;

        if (needsMint && fetched.record.publicationYear === null) {
            recordFailure(context, row.doi, "GET returned no integer publicationYear");
            fetchFailed = true;
            continue;
        }

        rowRecords.push({row, record: fetched.record});
    }

    if (fetchFailed) {
        return;
    }

    const changed = new Set<string>();

    if (canonicalRecord) {
        await fixUrl(context, "canonical", group.canonicalDoi, canonicalRecord, expectedCanonicalUrl(group.neuronId), null, changed);
    }

    for (const fetched of rowRecords) {
        await fixUrl(context, "reconstruction", fetched.row.doi, fetched.record, expectedReconstructionUrl(group.neuronId, fetched.row.reconstructionId), fetched.row.reconstructionId, changed);
    }

    let canonicalDoi: string | null = group.canonicalDoi;

    if (needsMint) {
        context.step = "mint";

        const publicationYear = Math.min(...rowRecords.map(fetched => fetched.record.publicationYear));
        const hasVersionEntries = held.map(doi => versionEntry("HasVersion", doi));

        if (!apply) {
            logAction(context, `would mint canonical (publication year ${publicationYear}, ${hasVersionEntries.length} HasVersion)`);
            counts.canonicalsMinted++;
            canonicalDoi = pendingCanonical;
            context.syncTarget = pendingCanonical;
            context.minting = true;
        } else {
            const result = await mintCanonical(context, publicationYear, hasVersionEntries);

            if (result.serviceStatus === DataCiteServiceStatus.Success) {
                logAction(context, `minted canonical ${result.doi} (publication year ${publicationYear}, ${hasVersionEntries.length} HasVersion)`);
                counts.canonicalsMinted++;
                canonicalDoi = result.doi;
                context.syncTarget = result.doi;
            } else {
                recordFailure(context, null, `assignCanonicalDoi: ${describeResult(result)}`);
                canonicalDoi = null;
            }
        }
    } else if (canonicalInPrefix) {
        context.step = "canonical relationships";

        const change = canonicalRelationshipChange(canonicalRecord.relatedIdentifiers, held);

        if (change) {
            await writeRelationships(context, "canonical", group.canonicalDoi, change, changed);
        }
    } else if (group.canonicalDoi !== null) {
        console.log(`    canonical ${group.canonicalDoi}: not under prefix, not read or written`);
        counts.doisOutOfPrefix++;
    }

    context.step = "reconstruction relationships";

    if (canonicalDoi === null) {
        console.log("    reconstruction relationships: skipped, no canonical");
    } else {
        for (const fetched of rowRecords) {
            const change = reconstructionRelationshipChange(fetched.record.relatedIdentifiers, canonicalDoi);

            if (change) {
                await writeRelationships(context, "reconstruction", fetched.row.doi, change, changed);
            }
        }
    }

    const fetchedCount = rowRecords.length + (canonicalRecord ? 1 : 0);

    counts.doisUnchanged += fetchedCount - changed.size;
}

async function syncSearchIndex(context: NeuronContext): Promise<void> {
    const target = context.syncTarget;

    if (!target) {
        return;
    }

    context.step = "search index";

    const neuronId = context.group.neuronId;
    const where = {neuronId, [Op.or]: [{canonicalDoi: null}, {canonicalDoi: {[Op.ne]: target}}]};

    let rowCount: number;

    if (!apply) {
        rowCount = context.minting ? await SearchIndex.count({where: {neuronId}}) : await SearchIndex.count({where});
    } else {
        [rowCount] = await SearchIndex.update({canonicalDoi: target}, {where});
    }

    if (rowCount > 0) {
        logAction(context, `search index: ${rowCount} rows ${would("updated", "update")}`);
        counts.searchIndexRows += rowCount;
    }
}

async function processNeuron(group: NeuronGroup, position: number, total: number): Promise<void> {
    console.log(`[${position}/${total}] neuron ${group.label} (${group.neuronId})${group.deleted ? " deleted" : ""}`);

    const context: NeuronContext = {
        group,
        step: "classify",
        actions: 0,
        failed: false,
        syncTarget: group.canonicalDoi,
        minting: false,
        mintedDoi: null
    };

    counts.neuronsScanned++;

    try {
        await processDataCite(context);
    } catch (err) {
        const orphaned = context.step === "mint" && context.mintedDoi ? ` (registered ${context.mintedDoi} was not recorded locally)` : "";

        recordFailure(context, null, `${errorMessage(err)}${orphaned}`);
    }

    try {
        await syncSearchIndex(context);
    } catch (err) {
        context.step = "search index";
        recordFailure(context, null, errorMessage(err));
    }

    if (context.failed) {
        counts.neuronsFailed++;
        console.log("    failed");
    } else if (context.actions === 0) {
        console.log("    no changes");
    }
}

function printSummary(): void {
    const label = (pastTense: string, dryRun: string) => apply ? pastTense : dryRun;

    console.log("");
    console.log(`Summary${apply ? "" : " (dry run; nothing was written)"}:`);
    console.log(`  neurons scanned: ${counts.neuronsScanned} (skipped ${counts.neuronsSkipped}, failed ${counts.neuronsFailed}, exempt ${counts.neuronsExempt})`);
    console.log(`  orphaned rows skipped: ${counts.rowsOrphaned}`);
    console.log(`  DOIs fetched: ${counts.doisFetched}`);
    console.log(`  DOIs skipped as out of prefix: ${counts.doisOutOfPrefix}`);
    console.log(`  DOIs needing no change: ${counts.doisUnchanged}`);
    console.log(`  ${label("URLs fixed", "URLs that would be fixed")}: ${counts.urlsFixed}`);
    console.log(`  ${label("canonicals minted", "canonicals that would be minted")}: ${counts.canonicalsMinted}`);
    console.log(`  ${label("relationship entries", "relationship entries that would be")} added ${counts.entriesAdded}, replaced ${counts.entriesReplaced}, removed ${counts.entriesRemoved}, across ${counts.listsRewritten} rewritten lists`);
    console.log(`  ${label("search index rows updated", "search index rows that would be updated")}: ${counts.searchIndexRows}`);
    console.log(`  URL mismatches: ${counts.mismatches}`);
}

function printFailures(): void {
    console.log("");

    if (failures.length === 0) {
        console.log("Failures: none");
        return;
    }

    console.log("Failures:");

    for (const failure of failures) {
        console.log(`  neuron ${failure.neuronId}${failure.doi ? ` ${failure.doi}` : ""} [${failure.step}]: ${failure.error}`);
    }
}

function printExempt(): void {
    console.log("");

    if (exemptNeurons.length === 0) {
        console.log("Deleted neurons without a canonical: none");
        return;
    }

    console.log("Deleted neurons without a canonical (exempt):");

    for (const group of exemptNeurons) {
        const dois = group.rows.filter(row => inPrefix(row.doi)).map(row => row.doi);

        console.log(`  ${group.label} (${group.neuronId}): ${dois.join(", ")}`);
    }
}

function printMismatches(): void {
    console.log("");

    if (mismatches.length === 0) {
        console.log("URL mismatches: none");
        return;
    }

    console.log("URL mismatches (not corrected):");
    console.log("");
    console.log("| Kind | DOI | Neuron | Reconstruction | Registered URL | Expected URL |");
    console.log("|---|---|---|---|---|---|");

    for (const mismatch of mismatches) {
        const cells = [
            mismatch.kind,
            mismatch.doi,
            mismatch.neuron,
            mismatch.reconstructionId ?? "–",
            mismatch.registeredUrl || "(empty)",
            mismatch.expectedUrl
        ];

        console.log(`| ${cells.map(escapeTableCell).join(" | ")} |`);
    }
}

async function main(): Promise<number> {
    const args = parseArguments();

    if (args === null) {
        console.error(usage);
        return 1;
    }

    apply = args.apply;
    intervalMs = args.intervalMs;

    const missing = ["prefix", "user", "password"].filter(key => !options[key]);

    if (missing.length > 0) {
        console.error(`DataCite configuration incomplete; missing ${missing.join(", ")} (NMCP_DOI_API_${missing.map(key => key.toUpperCase()).join(", NMCP_DOI_API_")})`);
        return 1;
    }

    printBanner(args);

    try {
        await connectDatabase(apply);
    } catch (err) {
        console.error(`database connection failed: ${errorMessage(err)}`);
        return 1;
    }

    systemInternalUser = await User.findByPk(SystemInternalId);

    if (!systemInternalUser) {
        console.error(`system internal user ${SystemInternalId} not found`);
        return 1;
    }

    const {groups, occurrences} = await loadGroups();

    if (!checkOwnership(occurrences)) {
        return 1;
    }

    let selected = Array.from(groups.values());

    if (args.neuronId) {
        selected = selected.filter(group => group.neuronId === args.neuronId);

        if (selected.length === 0) {
            console.error(`neuron ${args.neuronId} has no reconstruction DOIs`);
            return 1;
        }
    }

    console.log("");

    // Sequential on purpose: pacing and readable per-neuron logs both depend on it.
    for (let idx = 0; idx < selected.length; idx++) {
        await processNeuron(selected[idx], idx + 1, selected.length);
    }

    printSummary();
    printFailures();
    printExempt();
    printMismatches();

    return failures.length > 0 ? 1 : 0;
}

// Exits explicitly because the Sequelize pool keeps the process alive.
main()
    .then(code => process.exit(code))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
