import {CoreServiceOptions} from "../options/coreServicesOptions";
import {PortalNode} from "../io/portalFormat";
import {describeReceived, isPlainObject, primitiveText} from "../util/untrustedJson";

const debug = require("debug")("nmcp:nmcp-api:precomputed-service");

// The mutation holds the annotation lock and a pooled connection while it waits, so the wait is bounded.
const GenerateSkeletonTimeoutMilliseconds = 120_000;

export enum PrecomputedServiceStatus {
    Unavailable = 0,
    Error = 1,
    Success = 2
}

export type PrecomputedNeuron = {
    label: string;
    specimen: {
        label: string;
        genotype: string | null;
    };
}

export type PrecomputedReconstruction = {
    id: string;
    neuron: PrecomputedNeuron;
    nodes: PortalNode[];
}

export type PrecomputedResult = {
    serviceStatus: PrecomputedServiceStatus;
    errorKind: string | null;
    errorDescription: string | null;
    httpStatus: number | null;
}

function failure(errorKind: string, errorDescription: string | null): PrecomputedResult {
    return {serviceStatus: PrecomputedServiceStatus.Error, errorKind, errorDescription, httpStatus: null};
}

function isFiniteNumber(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * Total over any JSON value.  A 200 is Success only when it describes the skeleton that was requested.  The returned
 * location is not compared: the service answers with its normalized cloudpath, which can differ from the request's
 * text.  The matching ids are what tie the result to this request.
 */
export function toPrecomputedResult(reconstructionId: string, segmentId: number, body: unknown): PrecomputedResult {
    if (!isPlainObject(body)) {
        return failure("MalformedResponse", "the service response is not a JSON object");
    }

    if (body.errorKind !== null && body.errorKind !== undefined) {
        return failure(describeReceived(body.errorKind), primitiveText(body.errorDescription));
    }

    if (body.reconstructionId !== reconstructionId) {
        return failure("ReconstructionIdMismatch",
            `the service answered for reconstruction ${describeReceived(body.reconstructionId)} instead of ${reconstructionId}`);
    }

    const result = body.result;

    if (!isPlainObject(result)) {
        return failure("MalformedResponse", "the service response has no result");
    }

    if (result.segmentId !== segmentId) {
        return failure("MalformedResponse", `the result is for segment ${describeReceived(result.segmentId)} instead of ${segmentId}`);
    }

    if (!isFiniteNumber(result.nodeCount) || !isFiniteNumber(result.edgeCount)) {
        return failure("MalformedResponse", "the result has no node or edge count");
    }

    if (typeof result.location !== "string" || result.location.length === 0) {
        return failure("MalformedResponse", "the result has no location");
    }

    return {serviceStatus: PrecomputedServiceStatus.Success, errorKind: null, errorDescription: null, httpStatus: null};
}

// User-visible, so errorInfo, which can carry raw exception text, is never part of it.
export function failureMessage(result: PrecomputedResult): string {
    switch (result.serviceStatus) {
        case PrecomputedServiceStatus.Unavailable:
            return "The precomputed service could not be reached.";
        default:
            if (result.httpStatus !== null) {
                return `The precomputed service returned HTTP ${result.httpStatus}.`;
            }
            return `Skeleton generation failed (${result.errorKind ?? "unknown"}): ${result.errorDescription ?? "no description"}.`;
    }
}

export class PrecomputedService {
    public static async generateSkeleton(location: string, segmentId: number, reconstruction: PrecomputedReconstruction): Promise<PrecomputedResult> {
        const options = CoreServiceOptions.rest.precomputed;

        const url = `http://${options.host}:${options.port}${options.endpoint}`;

        debug(`calling precomputed service ${url} for ${reconstruction.id} (${reconstruction.nodes.length} nodes) at ${location}`);

        let response: Response;

        try {
            response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({location, segmentId, reconstruction}),
                signal: AbortSignal.timeout(GenerateSkeletonTimeoutMilliseconds)
            });
        } catch (error) {
            debug(`precomputed service exception: ${error}`);

            return {serviceStatus: PrecomputedServiceStatus.Unavailable, errorKind: null, errorDescription: null, httpStatus: null};
        }

        if (!response.ok) {
            debug(`precomputed service returned ${response.status}`);

            return {serviceStatus: PrecomputedServiceStatus.Error, errorKind: null, errorDescription: null, httpStatus: response.status};
        }

        let body: unknown;

        try {
            body = await response.json();
        } catch (error) {
            debug(`precomputed service returned an unreadable body: ${error}`);

            return failure("MalformedResponse", "the service response is not JSON");
        }

        const result = toPrecomputedResult(reconstruction.id, segmentId, body);

        if (result.serviceStatus !== PrecomputedServiceStatus.Success) {
            debug(`skeleton generation for ${reconstruction.id} failed (${result.errorKind}): ${result.errorDescription}`);
        }

        return result;
    }
}
