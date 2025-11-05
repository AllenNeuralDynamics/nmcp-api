import {CoreServiceOptions} from "../options/coreServicesOptions";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {User} from "../models/user";

const debug = require("debug")("nmcp:nmcp-api:quality-service");

//
// StandardMorph-specific.
//
type StandardMorphError = {
    testName: string;
    testDescription: string;
    affectedNodes: number[];
}

type StandardMorphOutput = {
    standardMorphVersion: string;
    warnings: StandardMorphError[];
    errors: StandardMorphError[];
}

//
// Service items, independent of QC output.
//
export enum QualityCheckServiceStatus {
    Unavailable = 0,
    Error = 1,
    Success = 2
}

export type QualityCheckServiceResult = {
    reconstructionId: string;
    serviceStatus: QualityCheckServiceStatus;
    serviceError: string;
    output: QualityControlOutput;
}

//
// Generic QC output structure to map from StandardMorph, etc.
//
export enum QualityControlScore {
    Error = 300,
    Failed = 400,
    Passed = 500,
    PassedWithWarnings = 600
}

export enum QualityControlServiceVersion {
    // To note substantial differences in tool
    v01 = 1 // Initial StandardMorph deployment
}

export type QualityControlTest = {
    name: string,
    description: string,
    nodes: number[]
}

export type QualityOutputShape = {
    serviceVersion: QualityControlServiceVersion;
    toolVersion: string;
    score: QualityControlScore;
    warnings: QualityControlTest[];
    errors: QualityControlTest[];
    toolError: string;
    when: Date
}

export class QualityControlOutput {
    public serviceVersion: QualityControlServiceVersion = QualityControlServiceVersion.v01;
    public toolVersion: string = "";
    public score: QualityControlScore = QualityControlScore.Error;
    public warnings: QualityControlTest[] = [];
    public errors: QualityControlTest[] = [];
    public toolError: string;
    when: Date

    public constructor(standardMorph: StandardMorphOutput, toolError: string) {
        this.when = new Date();

        if (standardMorph) {
            this.toolVersion = standardMorph.standardMorphVersion;

            this.warnings = standardMorph.warnings?.map(w => {
                return {
                    name: w.testName,
                    description: w.testDescription,
                    nodes: w.affectedNodes
                }
            }) ?? [];

            this.errors = standardMorph.errors?.map(w => {
                return {
                    name: w.testName,
                    description: w.testDescription,
                    nodes: w.affectedNodes
                }
            }) ?? [];

            this.score = this.errors.length > 0 ? QualityControlScore.Failed : (this.warnings.length > 0 ? QualityControlScore.PassedWithWarnings : QualityControlScore.Passed);
        }

        if (toolError) {
            this.toolError = toolError;
        }
    }
}

export class QualityCheckService {
    public static async performQualityCheck(reconstructionId: string): Promise<QualityCheckServiceResult> {
        const url = `http://${CoreServiceOptions.rest.qualityCheck.host}:${CoreServiceOptions.rest.qualityCheck.port}${CoreServiceOptions.rest.qualityCheck.endpoint}`;

        debug(`calling quality check service ${url} for reconstruction ${reconstructionId}`);

        const data = await AtlasReconstruction.getAsJSON(User.SystemInternalUser, reconstructionId);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({id: reconstructionId, data: data})
            });

            if (!response.ok) {
                // TODO ServiceHistory
                debug(`bad response status: ${response.status}`);

                return {
                    reconstructionId,
                    serviceStatus: QualityCheckServiceStatus.Error,
                    output: null,
                    serviceError: response.status.toString()
                };
            }

            const {id, result, error} = await response.json();

            return {
                reconstructionId: id,
                serviceStatus: QualityCheckServiceStatus.Success,
                output: new QualityControlOutput(result, error),
                serviceError: null
            }
        } catch (err) {
            // TODO ServiceHistory
            debug(`exception: ${err}`);
            return {
                reconstructionId,
                serviceStatus: QualityCheckServiceStatus.Unavailable,
                output: null,
                serviceError: err.message
            };
        }
    }
}
