import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, Op, Sequelize} from "sequelize";
import {concat, uniq, uniqBy} from "lodash"

import {ReconstructionTableName} from "./tableNames";
import {BaseModel} from "./baseModel";
import {Neuron} from "./neuron";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Tracing} from "./tracing";
import {AxonStructureId, DendriteStructureId} from "./tracingStructure";
import {User} from "./user";
import {Precomputed} from "./precomputed";
import {TracingNode} from "./tracingNode";
import {StructureIdentifier, StructureIdentifiers} from "./structureIdentifier";
import {AtlasStructure} from "./atlasStructure";
import {Sample} from "./sample";
import {Fluorophore} from "./fluorophore";
import {InjectionVirus} from "./injectionVirus";
import {Injection} from "./injection";
import {MouseStrain} from "./mouseStrain";
import {SearchContent} from "./searchContent";
import {Collection} from "./collection";
import {
    FullReviewPageInput,
    IErrorOutput,
    IReconstructionPage,
    IReconstructionPageInput,
    PeerReviewPageInput,
    ReviewPageInput
} from "../graphql/secureResolvers";
import {QualityCheck, QualityCheckService, QualityCheckServiceStatus} from "../data-access/qualityCheckService";
import {QualityCheckStatus} from "./qualityCheckStatus";

const debug = require("debug")("nmcp:nmcp-api:reconstruction-model");

export type PublishedReconstructionPageInput = {
    offset?: number;
    limit?: number;
    sampleIds?: string[];
}

export type PublishedReconstructionPage = {
    totalCount: number;
    offset: number;
    limit: number;
    sampleIds: string[];
    reconstructions: Reconstruction[];
}

export type NearestNodeOutput = {
    reconstructionId: string;
    location: number[];
    node: TracingNode;
    error: String;
}

export type ReconstructionDataNode = {
    sampleNumber: number;
    structureIdentifier: number;
    x: number;
    y: number;
    z: number;
    radius: number;
    parentNumber: number;
    allenId: number | null;
}

export type ReconstructionAllenInfo = {
    allenId: number;
    name: string;
    safeName: string;
    acronym: string;
    graphOrder: number;
    structurePath: string;
    colorHex: string;
}

export type ReconstructionAnnotationSpace = {
    version: number;
    description: string;
}

export type ReconstructionSoma = {
    x: number;
    y: number;
    z: number;
    allenId: number | null;
}

export type ReconstructionLabel = {
    virus: string;
    fluorophore: string;
}

export type ReconstructionSampleCollection = {
    id: string | null;
    name: string | null;
    description: string | null;
    reference: string | null;
}

export type ReconstructionSample = {
    date: Date | null;
    subject: string;
    genotype: string | null;
    collection: ReconstructionSampleCollection;
}

export type ReconstructionNeuronData = {
    id: string;
    idString: string;
    DOI: string | null;
    sample: ReconstructionSample;
    label: ReconstructionLabel[] | null;
    annotationSpace: ReconstructionAnnotationSpace;
    annotator: User | null;
    proofreader: User | null;
    peerReviewer: User | null;
    soma: ReconstructionSoma;
    axonId: string | null;
    axon: ReconstructionDataNode[];
    dendriteId: string | null;
    dendrite: ReconstructionDataNode[];
    allenInformation: ReconstructionAllenInfo[];
}

export type ReconstructionDataJSON = {
    comment: string;
    neurons: ReconstructionNeuronData[];
}

export type ReconstructionChunkInfo = {
    totalCount: number;
    offset: number;
    limit: number;
    hasMore: boolean;
}

export type ReconstructionHeaderData = {
    id: string;
    idString: string;
    DOI: string | null;
    sample: ReconstructionSample;
    label: ReconstructionLabel[] | null;
    annotationSpace: ReconstructionAnnotationSpace;
    annotator: User | null;
    proofreader: User | null;
    peerReviewer: User | null;
    soma: ReconstructionSoma | null;
    axonId: string | null;
    dendriteId: string | null;
}

export type ReconstructionDataChunked = {
    comment: string;
    header?: ReconstructionHeaderData;
    axon?: ReconstructionDataNode[];
    axonChunkInfo?: ReconstructionChunkInfo;
    dendrite?: ReconstructionDataNode[];
    dendriteChunkInfo?: ReconstructionChunkInfo;
    allenInformation?: ReconstructionAllenInfo[];
}

export enum QualityCheckErrorKind {
    // None = 0,
    InvalidArgument = 1,
    ServiceUnavailable = 2,
    ServiceError = 3,
    UnknownError = 4
}

export type QualityCheckOutput = {
    id: string;
    qualityCheckStatus?: QualityCheckStatus;
    qualityCheck?: QualityCheck;
    qualityCheckAt?: Date;
    error: {
        kind: QualityCheckErrorKind;
        message: string;
    }
}

export class Reconstruction extends BaseModel {
    status: ReconstructionStatus;
    doi: string;
    // notes: string;
    // checks: string;
    // durationHours: number;
    // lengthMillimeters: number;
    annotatorId: string;
    proofreaderId: string;
    neuronId: string;
    // startedAt: Date;
    completedAt: Date;
    qualityCheckStatus: number
    qualityCheckVersion: string
    qualityCheck: QualityCheck
    qualityCheckAt: Date

    public getAnnotator!: BelongsToGetAssociationMixin<User>;
    public getProofreader!: BelongsToGetAssociationMixin<User>;
    public getPeerReviewer!: BelongsToGetAssociationMixin<User>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getPrecomputed!: BelongsToGetAssociationMixin<Precomputed>;
    public getTracings!: HasManyGetAssociationsMixin<Tracing>;

    public readonly Neuron: Neuron;
    public readonly Tracings: Tracing[];
    public readonly Precomputed: Precomputed;

    private static _reconstructionCount: number = 0;

    public async hasRequiredTracings(): Promise<boolean> {
        const tracings = await this.getTracings({attributes: ["tracingStructureId"]});

        if (tracings.length != 2) {
            return false;
        }

        return tracings.some(t => t.tracingStructureId == AxonStructureId) && tracings.some(t => t.tracingStructureId == DendriteStructureId);
    }

    public async canPublish(qualityCheckStatus: QualityCheckStatus = null): Promise<boolean> {
        qualityCheckStatus ??= this.qualityCheckStatus;

        return (qualityCheckStatus == QualityCheckStatus.CompleteWithWarnings || qualityCheckStatus == QualityCheckStatus.Complete) &&
            await this.hasRequiredTracings();
    }

    public static async getAll(queryInput: IReconstructionPageInput, userId: string = null): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            reconstructions: []
        };

        let options = userId ? {where: {annotatorId: userId}, include: []} : {where: {}, include: []};

        if (queryInput.filters && queryInput.filters.length > 0) {
            options.where[Op.or] = queryInput.filters.map(f => {
                return {status: f};
            })
        }

        options.include.push({model: Neuron, as: "Neuron", include: [{model: Sample, as: "Sample"}]});

        if (queryInput.sampleIds && queryInput.sampleIds.length > 0) {
            options.where["$Neuron.Sample.id$"] = {[Op.in]: queryInput.sampleIds}
        }

        out.totalCount = await Reconstruction.count(options);

        options["order"] = [["Neuron", "Sample", "animalId", "ASC"], ["Neuron", "idString", "ASC"]];

        if (queryInput) {
            if (queryInput.offset) {
                options["offset"] = queryInput.offset;
                out.offset = queryInput.offset;
            }

            if (queryInput.limit) {
                options["limit"] = queryInput.limit;
                out.limit = queryInput.limit;
            }
        }

        if (out.limit === 1) {
            out.reconstructions = [await Reconstruction.findOne(options)];
        } else {
            out.reconstructions = await Reconstruction.findAll(options);
        }

        return out;
    }

    public static async getPublishedReconstructions(input?: PublishedReconstructionPageInput): Promise<PublishedReconstructionPage> {
        const page = {
            totalCount: 0,
            offset: input?.offset || 0,
            limit: input?.limit || 0,
            sampleIds: input?.sampleIds || [],
            reconstructions: []
        };

        const options = {where: {}, include: []};

        options.include.push({model: Neuron, as: "Neuron", include: [{model: Sample, as: "Sample"}]});

        if (input?.sampleIds && input.sampleIds.length > 0) {
            options.where["$Neuron.Sample.id$"] = {[Op.in]: input.sampleIds}
        }

        page.totalCount = await Reconstruction.count(options);

        options["order"] = [["Neuron", "Sample", "animalId", "ASC"], ["Neuron", "idString", "ASC"]];

        if (page.offset > 0) {
            options["offset"] = input.offset;
        }

        if (page.limit > 0) {
            options["limit"] = input.limit;
        }

        if (page.limit === 1) {
            page.reconstructions = [await Reconstruction.findOne(options)];
        } else {
            page.reconstructions = await Reconstruction.findAll(options);
        }

        return page;
    }

    public static async findPrecomputedMissing() {
        const options = {
            where: {
                "status": {
                    [Op.or]: [
                        // {[Op.eq]: ReconstructionStatus.InReview},
                        // {[Op.eq]: ReconstructionStatus.Approved},
                        // {[Op.eq]: ReconstructionStatus.ApprovedAndReady},
                        {[Op.eq]: ReconstructionStatus.PendingPrecomputed}
                    ]
                },
                "$Precomputed$": null
            },
            include: [
                {
                    model: Precomputed,
                    as: "Precomputed"
                },
                {
                    model: Tracing,
                    as: "Tracings",
                    attributes: ["searchTransformAt"]
                }
            ]
        };

        return await Reconstruction.findAll(options);
    }

    public static async isUserAnnotator(id: string, userId: string): Promise<boolean> {
        const reconstruction = await Reconstruction.findByPk(id, {
            attributes: ["annotatorId"]
        })

        return reconstruction && reconstruction.annotatorId == userId;
    }

    /**
     * Count the number of reconstructions for a given neuron.
     *
     * @param neuronId
     *
     * @return the number of reconstructions
     */
    public static async getCountForNeuron(neuronId: string): Promise<number> {
        if (!neuronId || neuronId.length === 0) {
            return 0;
        }

        let options = {where: {}};

        options.where["neuronId"] = {[Op.eq]: neuronId}

        return Reconstruction.count(options);
    }

    public static async getForNeuron(neuronId: string): Promise<Reconstruction[]> {
        if (!neuronId || neuronId.length === 0) {
            return [];
        }

        return await Reconstruction.findAll({where: {neuronId: neuronId}})
    }

    public static async getReconstructionsForUser(userId: string): Promise<Reconstruction[]> {
        return Reconstruction.findAll({
            where: {annotatorId: userId}
        });
    }

    public static async getPeerReviewableReconstructions(input: PeerReviewPageInput): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            reconstructions: []
        };

        try {
            const options = {
                where: {status: ReconstructionStatus.InPeerReview},
                include: {model: Neuron, as: "Neuron", include: [{model: Sample, as: "Sample"}]}
            };

            if (input.sampleIds && input.sampleIds.length > 0) {
                options.where["$Neuron.Sample.id$"] = {[Op.in]: input.sampleIds}
            }

            if (input.tag) {
                options.where["$Neuron.tag$"] = {[Op.iLike]: `%${input.tag}%`};
            }

            await this.configureFindOptions(out, options, input);

            if (out.limit === 1) {
                out.reconstructions = [await Reconstruction.findOne(options)];
            } else {
                out.reconstructions = await Reconstruction.findAll(options);
            }
        } catch (err) {
            debug(err);
        }

        return out;
    }

    private static async configureFindOptions(out: IReconstructionPage, options: FindOptions, input: ReviewPageInput) {
        out.totalCount = await Reconstruction.count(options);

        options["order"] = [["Neuron", "Sample", "animalId", "ASC"], ["Neuron", "idString", "ASC"]];

        if (input) {
            if (input.offset) {
                options["offset"] = input.offset;
                out.offset = input.offset;
            }

            if (input.limit) {
                options["limit"] = input.limit;
                out.limit = input.limit;
            }
        }
    }

    public static async getReviewableReconstructions(input: FullReviewPageInput): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            reconstructions: []
        };

        try {
            const options = {where: {}, include: []};

            if (input.status && input.status.length > 0) {
                options.where[Op.or] = input.status.map(f => {
                    return {status: f};
                })
            } else {
                options.where[Op.or] = [
                    {status: ReconstructionStatus.InReview},
                    {status: ReconstructionStatus.Approved},
                    {status: ReconstructionStatus.ApprovedAndReady}
                ]
            }

            options.include.push({model: Neuron, as: "Neuron", include: [{model: Sample, as: "Sample"}]});

            if (input.sampleIds && input.sampleIds.length > 0) {
                options.where["$Neuron.Sample.id$"] = {[Op.in]: input.sampleIds}
            }

            await this.configureFindOptions(out, options, input);

            if (out.limit === 1) {
                out.reconstructions = [await Reconstruction.findOne(options)];
            } else {
                out.reconstructions = await Reconstruction.findAll(options);
            }
        } catch (err) {
            debug(err);
        }

        return out;
    }

    public static async updateReconstruction(id: string, duration: number, length: number, notes: string, checks: string, status: ReconstructionStatus = ReconstructionStatus.Unknown): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        const update = {
            durationHours: duration,
            lengthMillimeters: length,
            notes: notes,
            checks: checks
        }

        if (status != ReconstructionStatus.Unknown) {
            update["status"] = status;
        }

        await reconstruction.update(update);

        return null;
    }

    public static async markAnnotationOnHold(id: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.OnHold});

        return null;
    }

    public static async markReconstructionForPeerReview(id: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.InPeerReview});

        return null;
    }

    public static async approveReconstructionPeerReview(id: string, peerReviewerId: string): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await reconstruction.update({status: ReconstructionStatus.InReview, peerReviewerId: peerReviewerId});

        return null;
    }

    public static async approveAnnotation(id: string, proofreaderId: string): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await reconstruction.update({
            status: await reconstruction.canPublish() ? ReconstructionStatus.ApprovedAndReady : ReconstructionStatus.Approved,
            proofreaderId: proofreaderId
        });

        return null;
    }

    public static async declineAnnotation(id: string, proofreaderId: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.Rejected, proofreaderId: proofreaderId});

        return null;
    }

    public static async publishAnnotation(id: string): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await reconstruction.update({
            status: ReconstructionStatus.PendingStructureAssignment
        });

        return null;
    }

    public static async reopenAnnotationAsApproved(id: string): Promise<void> {
        const reconstruction = await Reconstruction.findByPk(id);

        await reconstruction.update({status: await reconstruction.canPublish() ? ReconstructionStatus.ApprovedAndReady : ReconstructionStatus.Approved});
    }

    public static async cancelAnnotation(id: string): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await Reconstruction.destroy({
            where: {id: id}
        });

        return null;
    }

    public async getAxon(): Promise<Tracing> {
        return await Tracing.findOne({
            where: {reconstructionId: this.id, tracingStructureId: AxonStructureId}
        });
    }

    public async getDendrite(): Promise<Tracing> {
        return await Tracing.findOne({
            where: {reconstructionId: this.id, tracingStructureId: DendriteStructureId}
        });
    }

    public static async getPublishPending(status: ReconstructionStatus, limit: number = null): Promise<Reconstruction[]> {
        let options = {
            where: {
                status: status
            }
        };

        if (limit) {
            options["limit"] = limit;
        }

        if (status == ReconstructionStatus.PendingPrecomputed) {
            options["include"] = [
                {
                    model: Precomputed,
                    as: "Precomputed"
                }
            ];
        } else {
            options["include"] = [
                {
                    model: Tracing,
                    as: "Tracings",
                    required: true
                }
            ];
        }

        return Reconstruction.findAll(options);
    }

    public static reconstructionCount() {
        return this._reconstructionCount;
    }

    public static async loadReconstructionCache(reconstructionIds: string[] = []) {
        try {
            if (reconstructionIds.length > 0) {
                debug(`reloading reconstructions`);
                for (let id of reconstructionIds) {
                    const reconstruction = await Reconstruction.findByPk(id);

                    if (reconstruction) {
                        await reconstruction.reload();
                        debug(`reconstruction ${reconstruction.id} reloaded`);
                    }
                }
            }

            debug(`loading reconstruction cache`);

            const reconstructions: Reconstruction[] = await Reconstruction.findAll({
                where: {
                    status: ReconstructionStatus.Published
                }
            });

            debug(`${reconstructions.length} reconstructions marked published`);

            // const r = reconstructions.filter(r => r.getAxon() != null && r.getDendrite() != null);

            // debug(`${r.length} completed reconstructions have required tracings`);

            const n = uniq(reconstructions.map(r => r.neuronId));

            debug(`${reconstructions.length} published reconstructions represent ${n.length} unique neurons`);

            this._reconstructionCount = n.length;

            // const searchContent: SearchContent[] = await SearchContent.findAll({
            //     attributes: ["neuronId"]
            // });

            // debug(`${searchContent.length} searchContent represent ${_.uniq(searchContent.map(r => r.neuronId)).length} unique neurons`);

        } catch (err) {
            debug(err)
        }
    }


    public static async getAsJSON(id: string): Promise<ReconstructionDataJSON | null> {
        const reconstruction = await Reconstruction.findByPk(id, {
            include: [{
                model: Neuron,
                as: "Neuron",
                include: [{
                    model: Sample,
                    as: "Sample",
                    include: [{
                        model: Injection,
                        as: "Injections",
                        include: [{
                            model: InjectionVirus,
                            as: "InjectionVirus"
                        }, {
                            model: Fluorophore,
                            as: "Fluorophore"
                        }]
                    }, {
                        model: MouseStrain,
                        as: "MouseStrain"
                    }, {
                        model: Collection,
                        as: "Collection"
                    }]
                }]
            }, {
                model: Tracing,
                as: "Tracings",
                include: [{
                    model: TracingNode,
                    as: "Nodes",
                    include: [{
                        model: StructureIdentifier,
                        as: "StructureIdentifier"
                    }, {
                        model: AtlasStructure,
                        as: "BrainArea"
                    }]
                }]
            }]
        });

        if (!reconstruction || reconstruction.Tracings.length !== 2) {
            return null;
        }

        const tracingData = extractTracingData(reconstruction.Tracings);

        // Must have a soma to proceed
        if (!tracingData.soma) {
            return null;
        }

        return await transformReconstructionToJSON(reconstruction);
    }

    public static async getAsData(id: string): Promise<string> {
        const jsonData = await Reconstruction.getAsJSON(id);
        return jsonData ? JSON.stringify(jsonData) : null;
    }

    public static async getAsDataChunked(
        id: string,
        options: {
            parts?: string[];
            axonOffset?: number;
            axonLimit?: number;
            dendriteOffset?: number;
            dendriteLimit?: number;
        } = {}
    ): Promise<ReconstructionDataChunked | null> {
        // Default values for options
        const parts = options.parts || ["header", "axon", "dendrite", "allenInformation"];
        const axonOffset = options.axonOffset || 0;
        const axonLimit = options.axonLimit || null;
        const dendriteOffset = options.dendriteOffset || 0;
        const dendriteLimit = options.dendriteLimit || null;

        // Determine what data needs to be loaded
        const needsHeader = parts.includes("header");
        const needsAxon = parts.includes("axon");
        const needsDendrite = parts.includes("dendrite");
        const needsAllenInfo = parts.includes("allenInformation");
        const needsNodeData = needsAxon || needsDendrite;

        // Build includes conditionally - only load what's needed
        const includes: any[] = [];

        // Include Neuron data if header is requested
        if (needsHeader) {
            includes.push({
                model: Neuron,
                as: "Neuron",
                include: [{
                    model: Sample,
                    as: "Sample",
                    include: [{
                        model: Injection,
                        as: "Injections",
                        include: [{
                            model: InjectionVirus,
                            as: "InjectionVirus"
                        }, {
                            model: Fluorophore,
                            as: "Fluorophore"
                        }]
                    }, {
                        model: MouseStrain,
                        as: "MouseStrain"
                    }, {
                        model: Collection,
                        as: "Collection"
                    }]
                }]
            });
        }

        // Load base reconstruction
        const reconstruction = await Reconstruction.findByPk(id, {
            include: includes.length > 0 ? includes : undefined
        });

        if (!reconstruction) {
            return null;
        }

        // Initialize result
        const result: any = {
            comment: ""
        };

        // Identify axon and dendrite tracings
        let axonTracing: Tracing = null;
        let dendriteTracing: Tracing = null;
        let soma: any = null;

        // Load tracings metadata if any tracing data is needed
        if (needsNodeData || needsAllenInfo || needsHeader) {
            const tracings = await Tracing.findAll({
                where: {reconstructionId: id},
                attributes: ["id", "tracingStructureId"]
            });

            if (tracings.length !== 2) {
                return null;
            }

            for (const tracing of tracings) {
                if (tracing.tracingStructureId === "68e76074-1777-42b6-bbf9-93a6a5f02fa4") {
                    axonTracing = tracing;
                } else {
                    dendriteTracing = tracing;
                }
            }
        }

        // Find soma for header (usually in dendrite, node with sampleNumber 1)
        if (needsHeader && dendriteTracing) {
            const somaNode = await TracingNode.findOne({
                where: {
                    tracingId: dendriteTracing.id,
                    sampleNumber: 1
                },
                include: [{
                    model: StructureIdentifier,
                    as: "StructureIdentifier"
                }, {
                    model: AtlasStructure,
                    as: "BrainArea"
                }]
            });

            if (somaNode) {
                soma = {
                    x: somaNode.z,
                    y: somaNode.y,
                    z: somaNode.x,
                    allenId: somaNode.BrainArea ? somaNode.BrainArea.structureId : null
                };
            }
        }

        // Build header if requested
        if (needsHeader && reconstruction.Neuron) {
            const label = reconstruction.Neuron.Sample.Injections.map(i => ({
                virus: i.injectionVirus.name,
                fluorophore: i.fluorophore.name
            }));

            const sample = {
                date: reconstruction.Neuron.Sample.sampleDate,
                subject: reconstruction.Neuron.Sample.animalId,
                genotype: reconstruction.Neuron.Sample.MouseStrain?.name || null,
                collection: {
                    id: reconstruction.Neuron.Sample.Collection?.id || null,
                    name: reconstruction.Neuron.Sample.Collection?.name || null,
                    description: reconstruction.Neuron.Sample.Collection?.description || null,
                    reference: reconstruction.Neuron.Sample.Collection?.reference || null
                }
            };

            result.header = {
                id: reconstruction.Neuron.id,
                idString: reconstruction.Neuron.idString,
                DOI: reconstruction.Neuron.doi,
                sample,
                label: label.length > 0 ? label : null,
                annotationSpace: {
                    version: 3,
                    description: "Annotation Space: CCFv3.0 Axes> X: Anterior-Posterior; Y: Inferior-Superior; Z:Left-Right"
                },
                annotator: await reconstruction.getAnnotator(),
                proofreader: await reconstruction.getProofreader(),
                peerReviewer: await reconstruction.getPeerReviewer(),
                soma: soma,
                axonId: axonTracing ? axonTracing.id : null,
                dendriteId: dendriteTracing ? dendriteTracing.id : null
            };
        }

        // Load axon nodes with database-level pagination if requested
        if (needsAxon && axonTracing) {
            // Get total count first
            const totalAxonCount = await TracingNode.count({
                where: {tracingId: axonTracing.id}
            });

            // Load paginated nodes
            const axonNodes = await TracingNode.findAll({
                where: {tracingId: axonTracing.id},
                include: [{
                    model: StructureIdentifier,
                    as: "StructureIdentifier"
                }, {
                    model: AtlasStructure,
                    as: "BrainArea"
                }],
                order: [["sampleNumber", "ASC"]],
                offset: axonOffset,
                limit: axonLimit
            });

            result.axon = mapNodes(axonNodes, StructureIdentifiers.axon);
            result.axonChunkInfo = {
                totalCount: totalAxonCount,
                offset: axonOffset,
                limit: axonLimit || totalAxonCount,
                hasMore: axonOffset + (axonLimit || totalAxonCount) < totalAxonCount
            };
        }

        // Load dendrite nodes with database-level pagination if requested
        if (needsDendrite && dendriteTracing) {
            // Get total count first
            const totalDendriteCount = await TracingNode.count({
                where: {tracingId: dendriteTracing.id}
            });

            // Load paginated nodes
            const dendriteNodes = await TracingNode.findAll({
                where: {tracingId: dendriteTracing.id},
                include: [{
                    model: StructureIdentifier,
                    as: "StructureIdentifier"
                }, {
                    model: AtlasStructure,
                    as: "BrainArea"
                }],
                order: [["sampleNumber", "ASC"]],
                offset: dendriteOffset,
                limit: dendriteLimit
            });

            result.dendrite = mapNodes(dendriteNodes, StructureIdentifiers.basalDendrite);
            result.dendriteChunkInfo = {
                totalCount: totalDendriteCount,
                offset: dendriteOffset,
                limit: dendriteLimit || totalDendriteCount,
                hasMore: dendriteOffset + (dendriteLimit || totalDendriteCount) < totalDendriteCount
            };
        }

        // Load Allen information if requested
        if (needsAllenInfo && (axonTracing || dendriteTracing)) {
            const tracingIds = [axonTracing?.id, dendriteTracing?.id].filter(id => id != null);

            // Get unique brain areas from nodes
            const brainAreas = await TracingNode.findAll({
                where: {
                    tracingId: {[Op.in]: tracingIds},
                    brainAreaId: {[Op.ne]: null}
                },
                attributes: [],
                include: [{
                    model: AtlasStructure,
                    as: "BrainArea",
                    attributes: ["id", "structureId", "name", "safeName", "acronym", "graphOrder", "structureIdPath", "geometryColor"]
                }],
                group: ["BrainArea.id"],
                raw: false
            });

            const uniqueAreas = uniqBy(brainAreas.map(n => n.BrainArea).filter(b => b != null), "id");

            result.allenInformation = uniqueAreas.map(s => ({
                allenId: s.structureId,
                name: s.name,
                safeName: s.safeName,
                acronym: s.acronym,
                graphOrder: s.graphOrder,
                structurePath: s.structureIdPath,
                colorHex: s.geometryColor
            }));
        }

        return result;
    }

    public static async getQualityCheckPending(explicitPendingOnly: boolean = false): Promise<string[]> {
        const pending = await Reconstruction.findAll({
            where: {
                qualityCheckStatus: QualityCheckStatus.Pending
            }, attributes: ["id"]
        });

        if (!explicitPendingOnly) {
            const possible = await Reconstruction.findAll({
                where: {
                    qualityCheckStatus: QualityCheckStatus.NotReady,
                }, attributes: ["id", [Sequelize.fn('COUNT', Sequelize.col('Tracings.id')), 'TracingCount']],
                include: [{
                    model: Tracing,
                    as: 'Tracings',
                    attributes: [],
                    required: true,
                    duplicating: false
                }],
                group: ['Reconstruction.id']
            });

            pending.push(...possible.filter(p => p.getDataValue("TracingCount") == 2));
        }

        return pending.map(p => p.id);
    }

    public static async requestQualityCheck(id: string): Promise<QualityCheckOutput> {
        if (!id) {
            return {
                id, error: {
                    kind: QualityCheckErrorKind.InvalidArgument,
                    message: "The id argument is required."
                }
            };
        }

        let reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                id, error: {
                    kind: QualityCheckErrorKind.InvalidArgument,
                    message: `A reconstruction with the id ${id} could not be found.`
                }
            };
        }

        try {
            let updatedStatus: QualityCheckStatus = reconstruction.qualityCheckStatus;

            await reconstruction.update({qualityCheckStatus: QualityCheckStatus.InProgress});

            const qualityCheckOutput = await QualityCheckService.performQualityCheck(id);

            let status = reconstruction.status;
            let qualityCheck = reconstruction.qualityCheck;
            let standardMorphVersion = null;
            let error = null;

            if (qualityCheckOutput == null) {
                error = {
                    kind: QualityCheckErrorKind.ServiceError,
                    message: `An unknown error occurred with the quality check service.`
                };
            } else if (qualityCheckOutput.serviceStatus == QualityCheckServiceStatus.Unavailable) {
                error = {
                    kind: QualityCheckErrorKind.ServiceUnavailable,
                    message: qualityCheckOutput.error
                };
            } else if (qualityCheckOutput.serviceStatus == QualityCheckServiceStatus.Error) {
                updatedStatus = QualityCheckStatus.Errored;
                error = {
                    kind: QualityCheckErrorKind.ServiceError,
                    message: qualityCheckOutput.error
                };
            } else if (qualityCheckOutput.result == null) {
                updatedStatus = QualityCheckStatus.Errored;
                error = {
                    kind: QualityCheckErrorKind.ServiceError,
                    message: `An unknown error occurred with the quality check service.`
                };
            } else {
                qualityCheck = qualityCheckOutput.result;
                standardMorphVersion = qualityCheckOutput.result.standardMorphVersion;

                updatedStatus = qualityCheckOutput.result.warnings.length > 0 ? QualityCheckStatus.CompleteWithWarnings : QualityCheckStatus.Complete;

                updatedStatus = qualityCheckOutput.result.errors.length > 0 ? QualityCheckStatus.Failed : updatedStatus;

                if (status != ReconstructionStatus.Published && (await reconstruction.canPublish(updatedStatus))) {
                    status = ReconstructionStatus.ApprovedAndReady;
                }
            }

            reconstruction = await reconstruction.update({
                status,
                qualityCheckStatus: updatedStatus,
                qualityCheckVersion: standardMorphVersion,
                qualityCheck,
                qualityCheckAt: new Date()
            });

            debug(`reconstruction ${id} quality check status updated to ${updatedStatus}`);

            return {id, qualityCheckStatus: updatedStatus, qualityCheck, qualityCheckAt: reconstruction.qualityCheckAt, error: error};
        } catch (error) {
            debug(error);
            return {
                id, error: {
                    kind: QualityCheckErrorKind.UnknownError,
                    message: error.message
                }
            };
        }
    }

    public static async unpublish(id: string): Promise<boolean> {
        if (!id) {
            return false;
        }

        const reconstruction = await Reconstruction.findByPk(id, {
            include: [{
                model: Tracing,
                as: "Tracings",
                include: [{
                    model: TracingNode,
                    as: "Nodes",
                    include: [{
                        model: StructureIdentifier,
                        as: "StructureIdentifier"
                    }, {
                        model: AtlasStructure,
                        as: "BrainArea"
                    }]
                }]
            }]
        });

        if (!reconstruction) {
            return false;
        }

        const tracingIds = [];
        let nodes = [];

        reconstruction.Tracings.forEach(t => {
            nodes = nodes.concat(t.Nodes)
            tracingIds.push(t.id);
        });

        try {
            await TracingNode.sequelize.transaction(async (transaction) => {
                let promises = reconstruction.Tracings.map(async (t) => {
                    await TracingNode.update({brainStructureId: null}, {where: {tracingId: t.id}, transaction});
                });

                await Promise.all(promises);

                promises = reconstruction.Tracings.map(async (t) => {
                    await t.update({nodeLookupAt: null, searchTransformAt: null}, {transaction});
                });

                await Promise.all(promises);

                if (reconstruction.status == ReconstructionStatus.Published) {
                    await reconstruction.update({status: ReconstructionStatus.ApprovedAndReady}, {transaction});
                }

                // TODO Precomputed worker should periodically look for skeletons that are no longer part of the active
                await Precomputed.destroy({where: {reconstructionId: reconstruction.id}});

                promises = reconstruction.Tracings.map(async (t) => {
                    await SearchContent.destroy({where: {tracingId: t.id}, transaction});
                });

                await Promise.all(promises);
            });

            debug(`unpublished reconstruction ${id}`);
        } catch (err) {
            debug(err);
            return false;
        }

        await this.loadReconstructionCache()

        return true;
    }

    public static async deleteEntry(id: string): Promise<boolean> {
        const reconstruction = await Reconstruction.findByPk(id, {
            include: [{model: Tracing, as: "Tracings", attributes: ["id"]}]
        });

        if (!reconstruction) {
            return false;
        }

        const tracingIds = reconstruction.Tracings.map(t => t.id);

        try {
            await TracingNode.sequelize.transaction(async (transaction) => {
                const options = {
                    where: {tracingId: {[Op.in]: tracingIds}},
                    force: true,
                    transaction
                };

                await SearchContent.destroy(options);

                await TracingNode.destroy(options);

                await Tracing.destroy({
                    where: {id: {[Op.in]: tracingIds}},
                    force: true,
                    transaction
                });

                await Precomputed.destroy({
                    where: {reconstructionId: reconstruction.id},
                    force: true,
                    transaction
                });

                await reconstruction.destroy({force: true, transaction});
            });

            debug(`delete reconstruction ${id}`);
        } catch (err) {
            debug(err);
            return false;
        }

        await this.loadReconstructionCache()

        return true;
    }

    public static async nearestNode(id: string, location: number[]): Promise<NearestNodeOutput> {
        const output = {
            reconstructionId: id,
            location: location,
            node: null,
            error: null
        };

        if (!location || location.length < 3) {
            output.error = "invalid location argument";
            return output;
        }

        let reconstruction: Reconstruction = null;

        try {
            reconstruction = await Reconstruction.findByPk(id);
        } catch (err) {
            output.error = err.message;
            return output;
        }

        if (!reconstruction) {
            output.error = "reconstruction id not found";
            return output;
        }

        const tracings = await reconstruction.getTracings();

        if (!tracings) {
            output.error = "reconstruction does not contain any tracings";
            return output;
        }

        const values = await Promise.all(tracings.map(async (tracing) => {
            return tracing.nearestNode(location);
        }));

        let distance = Infinity;
        let nodeId = null;

        values.forEach((value) => {
            if (value.distance < distance) {
                distance = value.distance;
                nodeId = value.id;
            }
        });

        if (nodeId == null) {
            output.error = "could not identify nearest node";
            return output;
        }

        output.node = await TracingNode.findByPk(nodeId);

        return output;
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    Reconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        doi: DataTypes.TEXT,
        status: DataTypes.INTEGER,
        notes: DataTypes.TEXT,
        checks: DataTypes.TEXT,
        durationHours: DataTypes.DOUBLE,
        lengthMillimeters: DataTypes.DOUBLE,
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE,
        qualityCheckStatus: DataTypes.INTEGER,
        qualityCheckVersion: DataTypes.TEXT,
        qualityCheck: DataTypes.JSONB,
        qualityCheckAt: DataTypes.DATE
    }, {
        tableName: ReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Reconstruction.belongsTo(User, {foreignKey: "annotatorId", as: "Annotator"});
    Reconstruction.belongsTo(User, {foreignKey: "proofreaderId", as: "Proofreader"});
    Reconstruction.belongsTo(User, {foreignKey: "peerReviewerId", as: "PeerReviewer"});
    Reconstruction.belongsTo(Neuron, {foreignKey: "neuronId", as: "Neuron"});
    Reconstruction.hasMany(Tracing, {foreignKey: "reconstructionId", as: "Tracings"});
    Reconstruction.hasOne(Precomputed, {foreignKey: "reconstructionId", as: "Precomputed"});
};

// Pure transformation functions for testing
export function mapNodes(nodes: TracingNode[], structureIdentifier: StructureIdentifiers = null): ReconstructionDataNode[] {
    return nodes.map(n => {
        return {
            sampleNumber: n.sampleNumber,
            structureIdentifier: structureIdentifier ?? n.StructureIdentifier.value,
            x: n.x,
            y: n.y,
            z: n.z,
            radius: n.radius,
            parentNumber: n.parentNumber,
            allenId: n.BrainArea ? n.BrainArea.structureId : null
        }
    });
}

export type TracingJsonData = {
    axon: ReconstructionDataNode[];
    axonId: string | null;
    dendrite: ReconstructionDataNode[];
    dendriteId: string | null;
    soma: ReconstructionDataNode | null;
}

export function extractTracingData(tracings: any[]): TracingJsonData {
    let axon: ReconstructionDataNode[] = [];
    let axonId: string | null = null;
    let dendrite: ReconstructionDataNode[] = [];
    let dendriteId: string | null = null;

    const axonTracing = tracings.find(t => t.tracingStructureId == AxonStructureId);
    const dendriteTracing = tracings.find(t => t.tracingStructureId == DendriteStructureId);

    if (axonTracing) {
        axon = mapNodes(axonTracing.Nodes, StructureIdentifiers.axon).sort((a, b) => a.sampleNumber - b.sampleNumber);
        axonId = axonTracing.id;
    }

    if (dendriteTracing) {
        dendrite = mapNodes(dendriteTracing.Nodes, StructureIdentifiers.basalDendrite).sort((a, b) => a.sampleNumber - b.sampleNumber);
        dendriteId = dendriteTracing.id;
    }

    const soma = axon.find(n => n.sampleNumber === 1) || dendrite.find(n => n.sampleNumber === 1) || null;

    return {axon, axonId, dendrite, dendriteId, soma};
}

export function extractAllenInformation(tracings: Tracing[]): ReconstructionAllenInfo[] {
    const structures1 = tracings[0].Nodes.filter(n => n.BrainArea).map(n => n.BrainArea);
    const structures2 = tracings[1].Nodes.filter(n => n.BrainArea).map(n => n.BrainArea);
    const structures = uniqBy(concat(structures1, structures2), "id");

    return structures.map(s => ({
        allenId: s.structureId,
        name: s.name,
        safeName: s.safeName,
        acronym: s.acronym,
        graphOrder: s.graphOrder,
        structurePath: s.structureIdPath,
        colorHex: s.geometryColor
    }));
}

export function buildSampleData(sample: any): ReconstructionSample {
    return {
        date: sample.sampleDate,
        subject: sample.animalId,
        genotype: sample.MouseStrain?.name || null,
        collection: {
            id: sample.Collection?.id || null,
            name: sample.Collection?.name || null,
            description: sample.Collection?.description || null,
            reference: sample.Collection?.reference || null
        }
    };
}

export function buildLabelData(injections: any[]): ReconstructionLabel[] | null {
    if (!injections || injections.length === 0) {
        return null;
    }

    const labels = injections.map(i => ({
        virus: i.injectionVirus.name,
        fluorophore: i.fluorophore.name
    }));

    return labels.length > 0 ? labels : null;
}

export async function transformReconstructionToJSON(reconstruction: Reconstruction): Promise<ReconstructionDataJSON> {
    const tracingData = extractTracingData(reconstruction.Tracings);
    const allenInfo = extractAllenInformation(reconstruction.Tracings);
    const sample = buildSampleData(reconstruction.Neuron.Sample);
    const label = buildLabelData(reconstruction.Neuron.Sample.Injections);

    const neuronData: ReconstructionNeuronData = {
        id: reconstruction.Neuron.id,
        idString: reconstruction.Neuron.idString,
        DOI: reconstruction.Neuron.doi,
        sample,
        label,
        annotationSpace: {
            version: 3,
            description: "Annotation Space: CCFv3.0 Axes> X: Anterior-Posterior; Y: Inferior-Superior; Z:Left-Right"
        },
        annotator: await reconstruction.getAnnotator(),
        proofreader: await reconstruction.getProofreader(),
        peerReviewer: await reconstruction.getPeerReviewer(),
        soma: tracingData.soma ? {
            x: tracingData.soma.x,
            y: tracingData.soma.y,
            z: tracingData.soma.z,
            allenId: tracingData.soma.allenId
        } : {x: 0, y: 0, z: 0, allenId: null},
        axonId: tracingData.axonId,
        axon: tracingData.axon,
        dendriteId: tracingData.dendriteId,
        dendrite: tracingData.dendrite,
        allenInformation: allenInfo
    };

    return {
        comment: "",
        neurons: [neuronData]
    };
}
