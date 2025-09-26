const debug = require("debug")("nmcp:nmcp-api:quality-service");

import {CoreServiceOptions} from "../options/coreServicesOptions";
import {Reconstruction} from "../models/reconstruction";

export type StandardMorphError = {
    testName: string;
    testDescription: string;
    affectedNodes: number[];
}

export type QualityCheck = {
    standardMorphVersion: string;
    warnings: StandardMorphError[];
    errors: StandardMorphError[];
}

export enum QualityCheckServiceStatus {
    Unavailable = 0,
    Error = 1,
    Success = 2
}

export type QualityCheckServiceResult = {
    reconstructionId: string;
    serviceStatus: QualityCheckServiceStatus;
    result?: QualityCheck;
    error?: string;
}

export class QualityCheckService {
    public static async performQualityCheck(reconstructionId: string): Promise<QualityCheckServiceResult> {
        const url = `http://${CoreServiceOptions.rest.qualityCheck.host}:${CoreServiceOptions.rest.qualityCheck.port}${CoreServiceOptions.rest.qualityCheck.endpoint}`;

        debug(`calling quality check service ${url} for reconstruction ${reconstructionId}`);

        const data = await Reconstruction.getAsJSON(reconstructionId);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({id: reconstructionId, data: data})
            });

            if (!response.ok) {
                debug(`response status: ${response.status}`);

                return {
                    reconstructionId,
                    serviceStatus: QualityCheckServiceStatus.Error,
                    error: response.status.toString()
                };
            }

            return {reconstructionId, serviceStatus: QualityCheckServiceStatus.Success, ...await response.json()};
        } catch (error) {
            return {
                reconstructionId,
                serviceStatus: QualityCheckServiceStatus.Unavailable,
                error: error.message
            };
        }
    }
}
