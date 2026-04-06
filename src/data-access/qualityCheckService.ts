import {CoreServiceOptions} from "../options/coreServicesOptions";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {User} from "../models/user";

const debug = require("debug")("nmcp:nmcp-api:quality-service");

//
// StandardMorph-specific.
//
type StandardMorphTest = {
    testName: string;
    testDescription: string;
    affectedNodes: number[];
}

type StandardMorphOutput = {
    standardMorphVersion: string;
    passed: StandardMorphTest[];
    warnings: StandardMorphTest[];
    errors: StandardMorphTest[];
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
    v01 = 1, // Initial StandardMorph deployment
    v02 = 2  // StandardMorph updated to include name/description for test that pass
}

export type QualityControlTest = {
    name: string,
    description: string,
    nodes: number[]
}

export type QualityControlToolError = {
    kind: string;
    description: string;
    info: string;
}

export type QualityOutputShape = {
    serviceVersion: QualityControlServiceVersion;
    toolVersion: string;
    score: QualityControlScore;
    passed: QualityControlTest[];
    warnings: QualityControlTest[];
    errors: QualityControlTest[];
    toolError: QualityControlToolError;
    when: Date
}

export class QualityControlOutput {
    public serviceVersion: QualityControlServiceVersion = QualityControlServiceVersion.v02;
    public toolVersion: string = "";
    public score: QualityControlScore = QualityControlScore.Error;
    public passed: QualityControlTest[] = [];
    public warnings: QualityControlTest[] = [];
    public errors: QualityControlTest[] = [];
    public toolError: QualityControlToolError;
    when: Date

    public constructor(standardMorph: StandardMorphOutput, toolError: QualityControlToolError) {
        this.when = new Date();

        if (standardMorph) {
            this.toolVersion = standardMorph.standardMorphVersion;

            this.passed = standardMorph.passed?.map(item => {
                return {
                    name: item.testName,
                    description: item.testDescription,
                    nodes: item.affectedNodes
                }
            }) ?? [];

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
    public static async performQualityCheck(atlasReconstructionId: string): Promise<QualityCheckServiceResult> {
        const url = `http://${CoreServiceOptions.rest.qualityCheck.host}:${CoreServiceOptions.rest.qualityCheck.port}${CoreServiceOptions.rest.qualityCheck.endpoint}`;

        debug(`calling quality check service ${url} for reconstruction ${atlasReconstructionId}`);

        const data = await AtlasReconstruction.serializeNodes(User.SystemInternalUser, atlasReconstructionId);

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({id: atlasReconstructionId, data: data})
            });

            if (!response.ok) {
                // TODO ServiceHistory
                debug(`bad response status: ${response.status}`);

                return {
                    reconstructionId: atlasReconstructionId,
                    serviceStatus: QualityCheckServiceStatus.Error,
                    output: null,
                    serviceError: response.status.toString()
                };
            }

            const {reconstructionId, result, errorKind, errorDescription, errorInfo} = await response.json();

            const toolError = errorKind ? {kind: errorKind, description: errorDescription, info: errorInfo} : null;

            return {
                reconstructionId: reconstructionId,
                serviceStatus: QualityCheckServiceStatus.Success,
                output: new QualityControlOutput(result, toolError),
                serviceError: null
            }
        } catch (err) {
            // TODO ServiceHistory
            debug(`exception: ${err}`);
            return {
                reconstructionId: atlasReconstructionId,
                serviceStatus: QualityCheckServiceStatus.Unavailable,
                output: null,
                serviceError: err.message
            };
        }
    }
}
