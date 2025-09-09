const debug = require("debug")("nmcp:nmcp-api:quality-service");

import {CoreServiceOptions} from "../options/coreServicesOptions";
import {Reconstruction} from "../models/reconstruction";

export type StandardMorphError = {
    testName: string;
    testDescription: string;
    affectedNodes: number[];
}

export type QualityCheckResult = {
    reconstructionId: string;
    result: {
        standardMorphVersion: string;
        errors: StandardMorphError[];
    }
    error: string
}

export class QualityCheckService {
    public static async performQualityCheck(reconstructionId: string): Promise<QualityCheckResult> {
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
            }

            return response.json();
        } catch (error) {
            debug(error.message);
        }

        return null;
    }
}
