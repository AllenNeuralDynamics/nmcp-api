import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {pipeline} from "stream/promises";

import {CoreServiceOptions} from "../options/coreServicesOptions";
import {SimpleReconstructionRow} from "./simpleReconstruction";

/**
 * The parsed upload as the QC worker needs it, written before the attempt is handed off so the work survives a
 * restart.  skeletonSource is stored rather than recomputed so a configuration change cannot point QC elsewhere.
 */
export type RawUploadFile = {
    version: 1;
    qcTag: string;
    annotationId: string;
    notes: string;
    skeletonSource: string;
    segmentId: number;
    source: string;
    comments: string;
    rows: SimpleReconstructionRow[];
}

export function rawQualityControlDirectory(): string {
    return path.join(CoreServiceOptions.qualityControl.blobOutput, "raw");
}

export function uploadFilePath(qcTag: string): string {
    return path.join(rawQualityControlDirectory(), `nmcp-upload-${qcTag}.json`);
}

export function qualityControlDocumentPath(qcTag: string): string {
    return path.join(rawQualityControlDirectory(), `nmcp-qc-${qcTag}.json`);
}

/**
 * The blob output can be an S3 bucket mounted through FUSE, which has no rename (ENOSYS), so the file is staged in the
 * local temp directory and its bytes streamed into a new file under the final name.  Not fs.copyFile: on Linux it also
 * truncates and chmods the destination, which such a mount can refuse.  The final name is no longer written atomically:
 * an interrupted copy can leave a partial file there, which readUploadFile refuses as bad JSON.
 */
async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), "nmcp-raw-qc-"));

    try {
        const staged = path.join(staging, path.basename(filePath));

        await fs.promises.writeFile(staged, JSON.stringify(value));

        await fs.promises.mkdir(path.dirname(filePath), {recursive: true});

        await pipeline(fs.createReadStream(staged), fs.createWriteStream(filePath));
    } finally {
        await fs.promises.rm(staging, {recursive: true, force: true});
    }
}

export async function writeUploadFile(file: RawUploadFile): Promise<void> {
    await writeJsonFile(uploadFilePath(file.qcTag), file);
}

export async function publishQualityControlDocument(qcTag: string, document: unknown): Promise<void> {
    await writeJsonFile(qualityControlDocumentPath(qcTag), document);
}

export async function removeQualityControlDocument(qcTag: string): Promise<void> {
    await fs.promises.rm(qualityControlDocumentPath(qcTag), {force: true});
}

export async function uploadFileExists(qcTag: string): Promise<boolean> {
    try {
        await fs.promises.access(uploadFilePath(qcTag));
        return true;
    } catch {
        return false;
    }
}

export async function readUploadFile(qcTag: string): Promise<RawUploadFile> {
    const file = JSON.parse(await fs.promises.readFile(uploadFilePath(qcTag), "utf8"));

    if (file?.version !== 1) {
        throw new Error(`Unsupported raw upload file version ${file?.version} for ${qcTag}.`);
    }

    return file as RawUploadFile;
}

export function rawUploadQualityControlUrl(qcTag: string | null): string | null {
    const base = CoreServiceOptions.qualityControl.aindMetadataUrl;

    if (!qcTag || !base) {
        return null;
    }

    return `${base.replace(/\/$/, "")}/quality_control?name=nmcp-qc-${qcTag}`;
}

export async function postQualityControlDocument(qcTag: string, document: unknown, location: string): Promise<void> {
    const base = CoreServiceOptions.qualityControl.aindMetadataUrl;

    if (!base) {
        throw new Error("no metadata portal url is configured");
    }

    const url = `${base.replace(/\/$/, "")}/metadata-viz/temporary-metadata`;

    const response = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({quality_control: document, name: `nmcp-qc-${qcTag}`, location})
    });

    if (!response.ok) {
        throw new Error(`metadata portal responded ${response.status} to ${url}`);
    }
}
