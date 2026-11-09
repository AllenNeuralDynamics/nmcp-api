import {CoreServiceOptions} from "../options/coreServicesOptions";
import {PortalNode} from "../io/portalFormat";
import {describeReceived, isPlainObject, primitiveText} from "../util/untrustedJson";

const debug = require("debug")("nmcp:nmcp-api:quality-service");

export enum QualityCheckServiceStatus {
    Unavailable = 0,
    Error = 1,
    Success = 2
}

export enum QualityControlScore {
    Error = 300,
    Failed = 400,
    Passed = 500,
    PassedWithWarnings = 600
}

export enum QualityControlServiceVersion {
    // To note substantial differences in tool
    v01 = 1, // Initial StandardMorph deployment
    v02 = 2, // StandardMorph updated to include name/description for test that pass
    v03 = 3  // nmcp-qc on standard-morph 1.x: the output carries the QC-portal document as received
}

export type QualityCheckOptions = {
    isRegistered: boolean;
    skeletonSource?: string;
    segmentIds?: number[];
    imageSource?: string;
}

/**
 * The fields every stored output version carries, with the same meaning in each.  Everything else in a stored output
 * is specific to its version.
 */
export type QualityOutputShape = {
    serviceVersion: QualityControlServiceVersion;
    toolVersion: string;
    when: Date;
}

export type QualityControlServiceError = {
    stage: string;
    kind: string;
    description: string;
    info: string | null;
}

// Only what scoring reads; the stored document keeps every other key it arrived with.
export type QualityControlDocument = {
    metrics?: {
        name?: string;
        status_history?: { status?: string }[];
    }[];
}

export type QualityControlOutput = QualityOutputShape & {
    serviceVersion: QualityControlServiceVersion.v03;
    // nmcp-qc's own serviceVersion (its package version), renamed so it cannot collide with ours.
    qcServiceVersion: string;
    score: QualityControlScore;
    error: QualityControlServiceError | null;
    qualityControl: QualityControlDocument | null;
}

export type QualityCheckServiceResult = {
    reconstructionId: string;
    serviceStatus: QualityCheckServiceStatus;
    serviceError: string | null;
    output: QualityControlOutput | null;
}

// Marks an error nmcp-api found in a response it received, as opposed to nmcp-qc's input/standard_morph/output stages.
export const QualityControlResponseErrorStage = "response";

const MetricStatuses = ["Pass", "Fail", "Pending"];

function latestStatus(metric: unknown): unknown {
    if (!isPlainObject(metric)) {
        return undefined;
    }

    const history = metric.status_history;

    if (!Array.isArray(history) || history.length === 0) {
        return undefined;
    }

    const latest = history[history.length - 1];

    return isPlainObject(latest) ? latest.status : undefined;
}

function responseError(kind: string, description: string): QualityControlServiceError {
    return {stage: QualityControlResponseErrorStage, kind, description, info: null};
}

function serviceError(error: unknown): QualityControlServiceError {
    const fields = isPlainObject(error) ? error : {};

    return {
        stage: primitiveText(fields.stage) ?? "unknown",
        kind: primitiveText(fields.kind) ?? "unknown",
        description: primitiveText(fields.description) ?? "no description",
        info: primitiveText(fields.info)
    };
}

function documentError(document: unknown): QualityControlServiceError | null {
    if (!isPlainObject(document)) {
        return responseError("MissingDocument", "the service returned neither a document nor an error");
    }

    const metrics = document.metrics;

    if (!Array.isArray(metrics) || metrics.length === 0) {
        return responseError("MalformedDocument", "the document has no metrics");
    }

    for (let index = 0; index < metrics.length; index++) {
        if (!MetricStatuses.includes(latestStatus(metrics[index]) as string)) {
            return responseError("MalformedDocument", `metric ${index} has no recognized status`);
        }
    }

    return null;
}

function scoreForMetrics(metrics: unknown[]): QualityControlScore {
    const statuses = metrics.map(metric => latestStatus(metric));

    if (statuses.includes("Fail")) {
        return QualityControlScore.Failed;
    }

    return statuses.includes("Pending") ? QualityControlScore.PassedWithWarnings : QualityControlScore.Passed;
}

/**
 * Total over any JSON value: a throw here would surface from performQualityCheck as Unavailable, and the claim would be
 * released and retried forever instead of halting with a recorded reason.
 */
export function toQualityControlOutput(reconstructionId: string, body: unknown): QualityControlOutput {
    const envelope = isPlainObject(body) ? body : null;

    const output: QualityControlOutput = {
        serviceVersion: QualityControlServiceVersion.v03,
        toolVersion: typeof envelope?.standardMorphVersion === "string" ? envelope.standardMorphVersion : "",
        when: new Date(),
        qcServiceVersion: typeof envelope?.serviceVersion === "string" ? envelope.serviceVersion : "",
        score: QualityControlScore.Error,
        error: null,
        qualityControl: (envelope?.qualityControl ?? null) as QualityControlDocument | null
    };

    if (envelope === null) {
        output.error = responseError("MalformedResponse", "the service response is not a JSON object");
    } else if (envelope.reconstructionId !== reconstructionId) {
        // Ahead of the service error: a mismatched body describes some other reconstruction, whatever else it says.
        output.error = responseError("ReconstructionIdMismatch",
            `the service answered for reconstruction ${describeReceived(envelope.reconstructionId)} instead of ${reconstructionId}`);
    } else if (envelope.error !== null && envelope.error !== undefined) {
        output.error = serviceError(envelope.error);
    } else {
        output.error = documentError(envelope.qualityControl);
    }

    if (output.error === null) {
        output.score = scoreForMetrics(output.qualityControl.metrics);
    }

    return output;
}

export function failedMetricNames(output: QualityControlOutput): string[] {
    const metrics: unknown = isPlainObject(output.qualityControl) ? output.qualityControl.metrics : null;

    if (!Array.isArray(metrics)) {
        return [];
    }

    return metrics.flatMap((metric, index) => {
        if (latestStatus(metric) !== "Fail") {
            return [];
        }

        const name = isPlainObject(metric) ? metric.name : undefined;

        return [typeof name === "string" ? name : `metric ${index}`];
    });
}

/**
 * The error's info is left out on purpose: it can carry raw exception text, and this reason is stored and returned
 * publicly.
 */
export function qualityControlFailureReason(output: QualityControlOutput): string | null {
    switch (output.score) {
        case QualityControlScore.Error:
            return `quality control service error (${output.error?.stage ?? "unknown"}, ${output.error?.kind ?? "unknown"}): ${output.error?.description ?? "no description"}`;
        case QualityControlScore.Failed: {
            const names = failedMetricNames(output);
            return `quality control failed ${names.length} metric(s): ${names.join(", ")}`;
        }
        default:
            return null;
    }
}

export class QualityCheckService {
    public static async performQualityCheck(reconstructionId: string, nodes: PortalNode[], options: QualityCheckOptions): Promise<QualityCheckServiceResult> {
        const url = `http://${CoreServiceOptions.rest.qualityCheck.host}:${CoreServiceOptions.rest.qualityCheck.port}${CoreServiceOptions.rest.qualityCheck.endpoint}`;

        debug(`calling quality check service ${url} for reconstruction ${reconstructionId} (${nodes.length} nodes, registered: ${options.isRegistered})`);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    id: reconstructionId,
                    data: nodes,
                    isRegistered: options.isRegistered,
                    skeletonSource: options.skeletonSource,
                    segmentIds: options.segmentIds,
                    imageSource: options.imageSource
                })
            });

            if (!response.ok) {
                // TODO ServiceHistory
                debug(`bad response status: ${response.status}`);

                return {
                    reconstructionId: reconstructionId,
                    serviceStatus: QualityCheckServiceStatus.Error,
                    output: null,
                    serviceError: response.status.toString()
                };
            }

            const output = toQualityControlOutput(reconstructionId, await response.json());

            if (output.error !== null) {
                debug(`quality check for ${reconstructionId} reported ${output.error.stage} error ${output.error.kind}: ${output.error.description}`);
            }

            return {
                reconstructionId: reconstructionId,
                serviceStatus: QualityCheckServiceStatus.Success,
                output: output,
                serviceError: null
            }
        } catch (err) {
            // TODO ServiceHistory
            debug(`exception: ${err}`);
            return {
                reconstructionId: reconstructionId,
                serviceStatus: QualityCheckServiceStatus.Unavailable,
                output: null,
                serviceError: err.message
            };
        }
    }
}
