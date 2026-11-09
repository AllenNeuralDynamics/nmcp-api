import * as fs from "fs";
import * as path from "path";
import {randomUUID} from "crypto";

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

// Rename is atomic within a directory, so a crash never leaves a partial file under the final name.
async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), {recursive: true});

    const temporary = `${filePath}.${randomUUID()}.tmp`;

    await fs.promises.writeFile(temporary, JSON.stringify(value));

    await fs.promises.rename(temporary, filePath);
}

export async function writeUploadFile(file: RawUploadFile): Promise<void> {
    await writeJsonAtomically(uploadFilePath(file.qcTag), file);
}

export async function publishQualityControlDocument(qcTag: string, document: unknown): Promise<void> {
    await writeJsonAtomically(qualityControlDocumentPath(qcTag), document);
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
