import {BelongsToGetAssociationMixin, DataTypes, FindOptions, HasManyGetAssociationsMixin, Op, Sequelize, Transaction} from "sequelize";

import {BaseModel} from "./baseModel";
import {Neuron} from "./neuron";
import {
    AbandonableFailureStatuses,
    AtlasReconstructionStatus,
    ClaimedPhaseStatuses,
    DoiAssignmentStatusKinds,
    PrecomputedStatusKinds,
    QualityControlStatusKinds
} from "./atlasReconstructionStatus";
import {QualityControlStatus} from "./qualityControlStatus";
import {failureText, isTransientDatabaseError, PhaseOutcome, phaseFailureMessage} from "../util/phaseFailure";
import {User} from "./user";
import {Precomputed, PrecomputedGenerationStatus, PrecomputedStatus} from "./precomputed";
import {NodeStructure} from "./nodeStructure";
import {AtlasStructure} from "./atlasStructure";
import {Specimen} from "./specimen";
import {Fluorophore} from "./fluorophore";
import {InjectionVirus} from "./injectionVirus";
import {Injection} from "./injection";
import {Genotype} from "./genotype";
import {Collection} from "./collection";
import {Reconstruction} from "./reconstruction";
import {ReconstructionStatus} from "./reconstructionStatus";
import {GraphQLError} from "graphql/error";
import {AtlasReconstructionTableName} from "./tableNames";
import {QualityControl} from "./qualityControl";
import {AtlasNode, AtlasNodeShape, mapToAtlasNodeShape} from "./atlasNode";
import {EventLogItem, EventLogItemKind, recordEvent} from "./eventLogItem";
import {NeuronStructure} from "./neuronStructure";
import {NodeCounts, SimpleReconstruction} from "../io/simpleReconstruction";
import {Atlas} from "./atlas";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {SearchIndexOperation} from "../transform/searchIndexOperation";
import {SearchIndex} from "./searchIndex";
import {KDTree} from "../util/kdtree";
import {FiniteMap} from "../util/finiteMap";
import {PortalAnnotationSpace, PortalNode, PortalReconstruction} from "../io/portalFormat";
import {DataCiteRelatedIdentifier, DataCiteService, DataCiteServiceStatus} from "../data-access/doi/dataCiteService";
import {CoreServiceOptions} from "../options/coreServicesOptions";

const debug = require("debug")("nmcp:nmcp-api:atlas-reconstruction");

function hasRelatedIdentifier(existing: DataCiteRelatedIdentifier[], relationType: string, targetDoi: string): boolean {
    return existing.some(entry => entry.relationType === relationType && entry.relatedIdentifier === targetDoi);
}

type DataCiteOutcome = {
    serviceStatus: DataCiteServiceStatus;
    serviceError: string | null;
}

export type NearestNodeOutput = {
    reconstructionId: string;
    location: number[];
    node: AtlasNode;
    error: String;
}

export type AtlasReconstructionShape = {
    id?: string;
    status?: AtlasReconstructionStatus;
    doi?: string;
    lengthMillimeters?: number;
    nodeStructureAssignmentAt?: Date;
    searchIndexedAt?: Date;
    failureReason?: string;
    failedAt?: Date;
    reconstructionId?: string;
    reviewerId?: string;
}

export class AtlasReconstruction extends BaseModel {
    public sourceUrl: string;
    public sourceComments: string;
    public status: AtlasReconstructionStatus;
    public doi: string;
    public lengthMillimeters: number;
    public nodeCounts: NodeCounts;
    public nodeStructureAssignmentAt: Date;
    public searchIndexedAt: Date;
    public failureReason: string;
    public failedAt: Date;
    public reviewerId: string;
    public reconstructionId: string;

    public getReviewer!: BelongsToGetAssociationMixin<User>;
    public getPrecomputed!: BelongsToGetAssociationMixin<Precomputed>;
    public getReconstruction!: BelongsToGetAssociationMixin<Reconstruction>;
    public getQualityControl!: BelongsToGetAssociationMixin<QualityControl>;
    public getSoma!: BelongsToGetAssociationMixin<AtlasNode>;
    public getAtlasNodes!: HasManyGetAssociationsMixin<AtlasNode>;

    public readonly Precomputed: Precomputed;
    public readonly Reconstruction: Reconstruction;
    public readonly QualityControl: QualityControl;
    public readonly Reviewer: User;

    private static _nearestNodeCache: FiniteMap<string, KDTree> = new FiniteMap<string, KDTree>(10);

    private async recordEvent(kind: EventLogItemKind, details: object, user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.reconstructionId,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, t);
    }

    /**
     * Records a phase failure in its own transaction.  The transaction the phase was working in has been rolled back
     * by the time this runs, which is why it opens a fresh one - the same reason recordDoiOutcome does.
     *
     * afterFailure is the mirror of requestPhaseRetry's afterReset, and exists so the indexing phase can move its
     * parent to PublishFailed in the same transaction as the child's failure.  The other four phases pass nothing and
     * leave the parent where it is.
     */
    private async recordPhaseFailure(user: User, status: AtlasReconstructionStatus, reason: string, afterFailure: (t: Transaction) => Promise<void> = null): Promise<void> {
        await this.sequelize.transaction(async (t) => {
            const update = {status: status, failureReason: reason, failedAt: new Date()};

            await this.update(update, {transaction: t});

            await this.recordEvent(EventLogItemKind.AtlasReconstructionUpdate, update, user, t);

            await afterFailure?.(t);
        });
    }

    /**
     * Compare-and-set: the row moves to the claim only if it is still at the status the batch selected it on.  Under
     * the single-worker guarantee this cannot lose, but the conditional costs nothing and is what a second instance
     * would need.  No event - a claim is transient bookkeeping, and recording one would double the event log for a
     * healthy pipeline.
     */
    public async claim(expected: AtlasReconstructionStatus, claimed: AtlasReconstructionStatus): Promise<boolean> {
        const [affected] = await AtlasReconstruction.update({status: claimed}, {where: {id: this.id, status: expected}});

        if (affected === 1) {
            // The in-memory instance has to move with the row: the phase methods read this.status on the way in.
            this.status = claimed;
        }

        return affected === 1;
    }

    // The inverse, for a claim the phase is handing back because a dependency was unavailable.
    public async release(claimed: AtlasReconstructionStatus, pending: AtlasReconstructionStatus): Promise<void> {
        await AtlasReconstruction.update({status: pending}, {where: {id: this.id, status: claimed}});

        this.status = pending;
    }

    /**
     * Returns claims no phase is holding: one left by a process that died mid-item, or one whose release could not be
     * written.  Sound only because one worker polls this database and it runs at a pass boundary, where every phase
     * has either finished its item or released it - so every In... row is a leftover.  A second instance running this
     * would steal the first's live claims, which is the point at which the design has to be reconsidered rather than
     * extended.
     */
    public static async releasePhaseClaims(): Promise<number> {
        let released = 0;

        for (const [claimed, pending] of ClaimedPhaseStatuses) {
            const [affected] = await this.update({status: pending}, {where: {status: claimed}});

            released += affected;
        }

        return released;
    }

    public static async getPendingStructureAssignment(limit: number = 10): Promise<AtlasReconstruction[]> {
        return await this.findAll({
            where: {
                status: AtlasReconstructionStatus.PendingStructureAssignment
            },
            limit: limit
        });
    }

    // Eager-loads everything the DOI payloads read, so a batch does not repeat the same lazy loads per item.  The
    // Reconstruction include carries no alias because the association declares none.
    public static async getPendingDoiAssignment(limit: number = 10): Promise<AtlasReconstruction[]> {
        return await this.findAll({
            where: {
                status: AtlasReconstructionStatus.PendingDoiAssignment
            },
            include: [{
                model: User,
                as: "Reviewer"
            }, {
                model: Reconstruction,
                include: [{
                    model: Neuron,
                    as: "Neuron",
                    include: [{
                        model: Specimen,
                        as: "Specimen",
                        include: [{
                            model: Collection
                        }]
                    }]
                }, {
                    model: User,
                    as: "Annotator"
                }, {
                    model: User,
                    as: "Reviewer"
                }, {
                    model: User,
                    as: "TeamReviewer"
                }]
            }],
            limit: limit
        });
    }

    private static async createWithTransaction(user: User, shape: AtlasReconstructionShape, t: Transaction, substituteUser: User = null): Promise<AtlasReconstruction> {
        const reconstruction = await this.create(shape, {transaction: t});

        await reconstruction.recordEvent(EventLogItemKind.AtlasReconstructionCreate, shape, user, t, substituteUser);

        return reconstruction;
    }

    public static async createForShape(user: User, shape: AtlasReconstructionShape, t: Transaction = null, substituteUser: User = null): Promise<AtlasReconstruction> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, shape, t, substituteUser);
            })
        } else {
            return await this.createWithTransaction(user, shape, t, substituteUser);
        }
    }

    public async approve(user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        // Who approved publish review is a fact about the approval, not about whether the pipeline can start, and it is
        // what the DOI assignment phase credits as a contributor and toPortalFormat reports as the proofreader.
        const update = {reviewerId: user.id};

        await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.AtlasReconstructionApprove, update, user, t, substituteUser);

        await this.prepareToFinalize(user, t, substituteUser);
    }

    public async prepareToFinalize(user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        // Set up next step: QC if needed.
        // TODO change create to only create if needed for one call.
        let qc = await QualityControl.findOne({where: {reconstructionId: this.id}, transaction: t});

        if (!qc) {
            await QualityControl.createForReconstruction(user, this.id, t);
        } else {
            await qc.makePending(user, t);
        }

        // Pipeline entry, so any failure recorded by a previous run belongs to that run and not to this one.
        const qcUpdate = {status: AtlasReconstructionStatus.PendingQualityControl, failureReason: null, failedAt: null};

        await this.update(qcUpdate, {transaction: t});

        await this.recordEvent(EventLogItemKind.AtlasReconstructionQualityControlRequest, qcUpdate, user, t, substituteUser);

        // TODO change create to only create if needed for one call.
        // Set up Precomputed
        let precomputed = await Precomputed.findOne({where: {reconstructionId: this.id}, transaction: t});

        // Do not need to reset status.  Precomputed status will be set to pending after node structure assigment (after quality control)
        if (!precomputed) {
            await Precomputed.createForReconstruction(user, this.id, t);
        }
    }

    /**
     * A reject past approval is treated as a full reset: the child returns to the state a pre-approval reject would
     * have left it in, so a revised reconstruction re-enters the pipeline rather than resuming mid-way.  The DOI is the
     * exception - it is an external resource and is never unwound.
     *
     * The status is left alone for a child that never received atlas data, which would otherwise be claimed to hold
     * node counts it does not have.
     */
    public async reject(user: User, t: Transaction): Promise<AtlasReconstruction> {
        const update: AtlasReconstructionShape = {reviewerId: user.id};

        if (this.status !== AtlasReconstructionStatus.Initialized) {
            Object.assign(update, {
                status: AtlasReconstructionStatus.ReadyToProcess,
                failureReason: null,
                failedAt: null,
                nodeStructureAssignmentAt: null
            });
        }

        const rejected = await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.AtlasReconstructionReject, update, user, t);

        return rejected;
    }

    public static async discardForReconstruction(user: User, reconstructionId: string, t: Transaction): Promise<void> {
        // reconstructionId is the parent Reconstruction, not an AtlasReconstruction
        const reconstructions = await this.findAll({
            where: {
                reconstructionId: reconstructionId
            },
            attributes: ["id"],
            transaction: t
        });

        if (reconstructions.length > 0) {
            for (const reconstruction of reconstructions) {
                await reconstruction.recordEvent(EventLogItemKind.AtlasReconstructionDiscard, null, user, t);

                await QualityControl.destroy({where: {reconstructionId: reconstruction.id}, transaction: t});
            }

            const ids = reconstructions.map(t => t.id);

            await AtlasNode.destroy({
                where: {
                    reconstructionId: {
                        [Op.in]: ids
                    }
                }, transaction: t
            });

            await this.destroy({
                where: {
                    id: {[Op.in]: ids}
                }, transaction: t
            });
        }
    }

    public async replaceNodeData(user: User, reconstructionData: SimpleReconstruction, t: Transaction): Promise<AtlasReconstruction> {
        try {
            await this.update({somaNodeId: null}, {transaction: t});

            await AtlasNode.destroy({
                where: {reconstructionId: this.id},
                transaction: t
            });

            for (const structure of [reconstructionData.axon, reconstructionData.dendrite]) {
                const nodeData: AtlasNodeShape[] = structure.getNonSomaNodes().map(node => mapToAtlasNodeShape(node, structure.NeuronStructureId, this.id));

                const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

                for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                    await AtlasNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction: t});
                }
            }

            const somaShape = mapToAtlasNodeShape(reconstructionData.axon.soma, NeuronStructure.SomaNeuronStructureId, this.id);

            const soma = await AtlasNode.create(somaShape, {transaction: t});

            const updated = await this.update({
                sourceUrl: reconstructionData.source,
                sourceComments: reconstructionData.comments,
                status: AtlasReconstructionStatus.ReadyToProcess,
                nodeCounts: {axon: reconstructionData.axon.nodeCounts, dendrite: reconstructionData.dendrite.nodeCounts},
                somaNodeId: soma?.id,
                // New data, so a failure recorded against the data it replaces no longer describes this row.
                failureReason: null,
                failedAt: null
            }, {transaction: t});

            await this.recordEvent(EventLogItemKind.AtlasReconstructionUpload, null, user, t);

            return updated;
        } catch (error) {
            debug(error);
            throw error;
        }
    }

    /**
     * The quality control status rather than a boolean, so that a StandardMorph tool error stays distinguishable
     * from a genuine morphology failure in the record.  Both halt at FailedQualityControl and wait for a person;
     * failureReason is what says which.  Runs on the caller's transaction - assess has committed nothing yet, and
     * its row write and this one belong together.
     */
    public async qualityControlChanged(status: QualityControlStatus, failureReason: string | null, user: User, t: Transaction): Promise<void> {
        if (QualityControlStatusKinds.includes(this.status)) {
            const passed = status === QualityControlStatus.Passed;

            await this.recordEvent(EventLogItemKind.AtlasReconstructionQualityControlComplete, {passed: passed}, user, t);

            const update = passed
                ? {status: AtlasReconstructionStatus.PendingStructureAssignment, failureReason: null, failedAt: null}
                : {status: AtlasReconstructionStatus.FailedQualityControl, failureReason: failureReason, failedAt: new Date()};

            await this.update(update, {transaction: t});

            const kind = passed ? EventLogItemKind.AtlasReconstructionNodeStructureAssignmentRequest : EventLogItemKind.AtlasReconstructionUpdate;

            await this.recordEvent(kind, update, user, t);

        } else {
            // TODO SystemError
            debug(`received unexpected quality control update (current status: ${this.status})`);
        }
    }

    public async calculateStructureAssignments(user: User): Promise<PhaseOutcome> {
        try {
            const data = await this.getReconstruction({
                include: [{
                    model: Neuron,
                    as: "Neuron",
                    include: [{
                        model: Specimen,
                        as: "Specimen",
                        attributes: ["atlasId"]
                    }]
                }]
            });

            const atlasId = data.Neuron.Specimen.atlasId;

            const atlas = Atlas.getAtlas(atlasId);

            // An atlas the cache does not hold is a property of this specimen, not a passing problem: every retry
            // finds the same missing atlas.  Recorded rather than thrown, so the row stops being re-selected.
            if (!atlas) {
                await this.recordPhaseFailure(user, AtlasReconstructionStatus.FailedStructureAssignment, `no atlas is loaded for specimen atlas ${atlasId}`);

                return PhaseOutcome.Handled;
            }

            const where = {reconstructionId: this.id, manualAtlasAssigment: false};

            const count = await AtlasNode.count({where: where});

            debug(`assigning atlas structures to ${count} nodes for reconstruction ${this.id} where manual Atlas assignment is false`);

            await this.sequelize.transaction(async (t) => {
                for (let idx = 0; idx < count; idx += AtlasReconstruction.PreferredDatabaseChunkSize) {
                    const nodes = await AtlasNode.findAll({
                        where: where,
                        offset: idx,
                        limit: AtlasReconstruction.PreferredDatabaseChunkSize,
                        order: [["index", "ASC"]],
                        transaction: t
                    });

                    const structureMap = new Map<string, string[]>();

                    for (const node of nodes) {
                        const structureId = atlas.findForLocation({x: node.x, y: node.y, z: node.z}, true);
                        let list = structureMap.get(structureId);
                        if (!list) {
                            list = [];
                            structureMap.set(structureId, list);
                        }
                        list.push(node.id);
                    }

                    for (const [key, value] of structureMap.entries()) {
                        await AtlasNode.update({
                            atlasStructureId: key
                        }, {where: {id: {[Op.in]: value}}, transaction: t});
                    }

                    debug(`\tassigned ${structureMap.size} unique atlas structures to ${nodes.length} nodes`);
                }

                let update = {nodeStructureAssignmentAt: Date.now()};

                await this.update(update, {transaction: t});

                await this.recordEvent(EventLogItemKind.AtlasReconstructionNodeStructureAssignmentComplete, update, user, t);

                const statusUpdate = {status: AtlasReconstructionStatus.PendingPrecomputed, failureReason: null, failedAt: null};

                await this.update(statusUpdate, {transaction: t});

                const precomputed = await this.getPrecomputed({transaction: t});

                await precomputed.requestGeneration(user, t);

                await this.recordEvent(EventLogItemKind.AtlasReconstructionPrecomputedRequest, statusUpdate, user, t);
            });

            return PhaseOutcome.Handled;
        } catch (error) {
            debug(`structure assignment failed for ${this.id}: ${failureText(error)}`);

            if (isTransientDatabaseError(error)) {
                await this.release(AtlasReconstructionStatus.InStructureAssignment, AtlasReconstructionStatus.PendingStructureAssignment);

                return PhaseOutcome.Released;
            }

            await this.recordPhaseFailure(user, AtlasReconstructionStatus.FailedStructureAssignment, phaseFailureMessage("structure assignment", error));

            return PhaseOutcome.Handled;
        }
    }

    /**
     * The generation status rather than a boolean, so FailedToLoad and FailedToGenerate stay distinguishable on the
     * child.  It is the only diagnostic the precomputed service supplies - PrecomputedUpdateShape carries no
     * message - and it is bounded, so it is safe to record verbatim.
     */
    public async precomputedChanged(user: User, status: PrecomputedGenerationStatus, t: Transaction): Promise<void> {
        if (PrecomputedStatusKinds.includes(this.status)) {
            const complete = status === PrecomputedStatus.Complete;

            await this.recordEvent(EventLogItemKind.AtlasReconstructionPrecomputedComplete, {complete: complete}, user, t);

            const update = complete
                ? {status: AtlasReconstructionStatus.PendingDoiAssignment, failureReason: null, failedAt: null}
                : {
                    status: AtlasReconstructionStatus.FailedPrecomputed,
                    failureReason: `precomputed generation failed (${PrecomputedStatus[status]})`,
                    failedAt: new Date()
                };

            await this.update(update, {transaction: t});

            // No parent notification: the parent stays WaitingForAtlasReconstruction until DOI assignment completes,
            // and assignDois makes that call itself.
            const kind = complete ? EventLogItemKind.AtlasReconstructionDoiAssignmentRequest : EventLogItemKind.AtlasReconstructionUpdate;

            await this.recordEvent(kind, update, user, t);

        } else {
            // TODO SystemError
            debug(`received unexpected precomputed update (current status: ${this.status})`);
        }
    }

    /**
     * Registers the neuron's canonical DOI and this reconstruction's DOI with DataCite, then advances to
     * ReadyToPublish.  ServiceUnavailable means the claim was handed back for the next pass and the caller backs
     * off; Released the same for a database transient; Handled that the item was dealt with, whether it advanced
     * or was recorded as failed.
     *
     * Each of the three registration steps is an ensure, so a pass that dies part-way is resumed rather than repeated.
     * Both DOIs are reserved as DataCite drafts and promoted to findable only once recorded locally: what a crash
     * between the two strands is then an invisible draft rather than a citable duplicate that cannot be withdrawn.
     *
     * The outer try covers everything, not just the DataCite calls: the association reads and the four commits below
     * are the part that used to throw with the claim still held and no failure recorded.  It adds a catch and nothing
     * else - T1 to T4 keep their staging, which is what makes a part-way-through pass resumable.
     */
    public async assignDois(user: User): Promise<PhaseOutcome> {
        try {
            return await this.assignDoisWithinPhase(user);
        } catch (error) {
            debug(`doi assignment failed for ${this.id}: ${failureText(error)}`);

            if (isTransientDatabaseError(error)) {
                await this.release(AtlasReconstructionStatus.InDoiAssignment, AtlasReconstructionStatus.PendingDoiAssignment);

                return PhaseOutcome.Released;
            }

            await this.recordPhaseFailure(user, AtlasReconstructionStatus.FailedDoiAssignment, phaseFailureMessage("doi assignment", error));

            return PhaseOutcome.Handled;
        }
    }

    private async assignDoisWithinPhase(user: User): Promise<PhaseOutcome> {
        if (!DoiAssignmentStatusKinds.includes(this.status)) {
            // TODO SystemError
            debug(`received unexpected doi assignment request (current status: ${this.status})`);
            return PhaseOutcome.Handled;
        }

        const options = CoreServiceOptions.rest.doiGeneration;

        const reconstruction = this.Reconstruction ?? await this.getReconstruction();
        const neuron = reconstruction.Neuron ?? await reconstruction.getNeuron({include: [{model: Specimen, as: "Specimen", include: [{model: Collection}]}]});
        const specimen = neuron.Specimen ?? await neuron.getSpecimen({include: [{model: Collection}]});
        const collection = specimen.Collection ?? await specimen.getCollection();
        const annotator = reconstruction.Annotator ?? await reconstruction.getAnnotator();
        const peerReviewer = reconstruction.reviewerId ? (reconstruction.Reviewer ?? await reconstruction.getReviewer()) : null;
        const teamReviewer = reconstruction.teamReviewerId ? (reconstruction.TeamReviewer ?? await reconstruction.getTeamReviewer()) : null;
        const reviewer = this.reviewerId ? (this.Reviewer ?? await this.getReviewer()) : null;

        const publicationYear = await this.publicationYear();

        // T1: the neuron row lock covers the canonical's existence check and its minting together, so two sibling
        // reconstructions of one neuron cannot both read it as unset and both mint.  Committed before the
        // reconstruction create begins - nothing later in the phase may be able to roll this write back.
        const canonical = await this.sequelize.transaction(async (t) => {
            const locked = await Neuron.findByPk(reconstruction.neuronId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            return await locked.assignCanonicalDoi(user, publicationYear, [], t);
        });

        if (canonical.serviceStatus !== DataCiteServiceStatus.Success) {
            return await this.recordDoiOutcome(user, canonical, "canonical registration");
        }

        const canonicalDoi = canonical.doi;

        if (!this.doi) {
            const contributors = [];

            for (const contributor of [reviewer, peerReviewer, teamReviewer]) {
                if (contributor && !contributor.isSystemUser) {
                    contributors.push({name: contributor.DisplayName, affiliation: contributor.affiliation, contributorType: "Other"});
                }
            }

            // Deliberately untransacted - the create is a remote call, and holding T2 open across it would pin a
            // pooled connection on DataCite's latency.  The identifier is findable from the moment DataCite answers.
            const created = await DataCiteService.createDoi({
                data: {
                    type: "dois",
                    attributes: {
                        event: "publish",
                        prefix: options.prefix,
                        creators: [{name: annotator.DisplayName}],
                        titles: [{title: `Neuron ${neuron.label} in the ${collection?.name ?? "(unspecified)"} collection`}],
                        publisher: "Neuron Morphology Community Portal",
                        publicationYear: publicationYear,
                        types: {resourceTypeGeneral: "Dataset"},
                        url: `${options.url}neuron/${neuron.id}/${reconstruction.id}`,
                        subjects: [{subject: "Neuron reconstruction"}],
                        contributors,
                        alternateIdentifiers: [{alternateIdentifier: neuron.label, alternateIdentifierType: "Neuron Label"}],
                        relatedIdentifiers: [{relatedIdentifierType: "DOI", relationType: "IsVersionOf", relatedIdentifier: canonicalDoi, resourceTypeGeneral: "Dataset"}],
                        version: 1,
                        rights: "CC-BY-4.0"
                    }
                }
            });

            if (created.serviceStatus !== DataCiteServiceStatus.Success) {
                return await this.recordDoiOutcome(user, created, "reconstruction registration");
            }

            // Logged before the write that records it: this line is the only trace the registration leaves if the
            // write or the commit that follows fails, and an orphaned identifier is only findable by hand through it.
            debug(`doi registered for reconstruction ${this.id}: ${created.doi}`);

            // T2.
            await this.sequelize.transaction(async (t) => {
                await this.update({doi: created.doi}, {transaction: t});

                // Recorded against the parent reconstruction, matching where ReconstructionAssignDoi has always been
                // written; Reconstruction.recordEvent is private, hence the direct call.
                await recordEvent({
                    kind: EventLogItemKind.ReconstructionAssignDoi,
                    targetId: reconstruction.id,
                    parentId: reconstruction.neuronId,
                    details: {doi: created.doi},
                    userId: user.id
                }, t);
            });
        }

        const crossReference = await this.crossReferenceCanonical(reconstruction.neuronId, canonicalDoi);

        if (crossReference.serviceStatus !== DataCiteServiceStatus.Success) {
            return await this.recordDoiOutcome(user, crossReference, "canonical cross-reference");
        }

        // T4.
        await this.sequelize.transaction(async (t) => {
            await this.recordEvent(EventLogItemKind.AtlasReconstructionDoiAssignmentComplete, {doi: this.doi, canonicalDoi: canonicalDoi}, user, t);

            const update = {status: AtlasReconstructionStatus.ReadyToPublish, failureReason: null, failedAt: null};

            await this.update(update, {transaction: t});

            await this.recordEvent(EventLogItemKind.AtlasReconstructionUpdate, update, user, t);

            const parent = await this.getReconstruction({transaction: t});

            await parent.onAtlasReconstructionStatusChanged(user, update.status, t);
        });

        return PhaseOutcome.Handled;
    }

    /**
     * T3: adds this reconstruction to the canonical's HasVersion list.
     * The neuron row lock covers the read, the membership check and the write as one critical section - updateDoi
     * replaces the whole array, so two siblings that each read the same list and append their own entry would
     * otherwise leave only the later one's.  No local writes, so a rollback here discards nothing.
     */
    private async crossReferenceCanonical(neuronId: string, canonicalDoi: string): Promise<DataCiteOutcome> {
        return await this.sequelize.transaction(async (t) => {
            await Neuron.findByPk(neuronId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const existing = await DataCiteService.getRelatedIdentifiers(canonicalDoi);

            if (existing.serviceStatus !== DataCiteServiceStatus.Success) {
                return existing;
            }

            const merged = hasRelatedIdentifier(existing.relatedIdentifiers, "HasVersion", this.doi)
                ? existing.relatedIdentifiers
                : [...existing.relatedIdentifiers, {
                    relatedIdentifierType: "DOI" as const,
                    relationType: "HasVersion" as const,
                    relatedIdentifier: this.doi,
                    resourceTypeGeneral: "Dataset"
                }];

            // Written even when the list is unchanged: re-sending an identical array is harmless, and branching on it
            // would leave the two siblings' paths differing for no gain.
            return await DataCiteService.updateDoi(canonicalDoi, merged);
        });
    }

    /**
     * The year the precomputed generation completed, from the child's own event - recordEvent writes targetId as the
     * atlas reconstruction id.  Ordered DESC because precomputedChanged records this kind on the failure path too.
     */
    private async publicationYear(): Promise<number> {
        const precomputedEvent = await EventLogItem.findOne({
            where: {targetId: this.id, kind: EventLogItemKind.AtlasReconstructionPrecomputedComplete},
            order: [["createdAt", "DESC"]]
        });

        // A child that reached this phase without the event is a data anomaly, not a service failure, and not a
        // reason to refuse it a DOI.
        return precomputedEvent?.createdAt.getFullYear() ?? new Date().getFullYear();
    }

    /**
     * Unavailable hands the claim back for the next pass and tells the worker to back off.  Error is an answer from
     * the service, so the child is failed here and the batch keeps going.  Whatever earlier steps committed stays
     * committed either way: a recorded DOI is never unwound, and the retry resumes from the ensure that failed.
     *
     * serviceError is DataCite's own response text rather than an exception dump, so it is safe to store verbatim.
     */
    private async recordDoiOutcome(user: User, outcome: DataCiteOutcome, step: string): Promise<PhaseOutcome> {
        if (outcome.serviceStatus == DataCiteServiceStatus.Unavailable) {
            debug(`doi service unavailable during ${step} for ${this.id}: ${outcome.serviceError}`);

            await this.release(AtlasReconstructionStatus.InDoiAssignment, AtlasReconstructionStatus.PendingDoiAssignment);

            return PhaseOutcome.ServiceUnavailable;
        }

        debug(`doi service rejected ${step} for ${this.id}: ${outcome.serviceError}`);

        await this.recordPhaseFailure(user, AtlasReconstructionStatus.FailedDoiAssignment, `${step}: ${outcome.serviceError}`);

        return PhaseOutcome.Handled;
    }

    /**
     * Rewinds a child one phase failed on so the worker picks it up again.  No parent-status check is needed because
     * the parent stays WaitingForAtlasReconstruction throughout the automatic phases; FailedSearchIndexing is the one
     * exception, reachable with the parent at PublishFailed, and requestSearchIndexing moves it back through afterReset.
     *
     * The guard is the exact failure being reversed, which also refuses an In... status: a claim is released by the
     * worker or the sweep at the top of its next pass, never by hand.  A discarded or untraceable reconstruction
     * soft-deletes its child, so findOne cannot see it and this throws rather than reviving a dead phase.
     */
    private static async requestPhaseRetry(
        user: User,
        reconstructionId: string,
        phase: string,
        failed: AtlasReconstructionStatus,
        pending: AtlasReconstructionStatus,
        kind: EventLogItemKind,
        afterReset: (atlasReconstruction: AtlasReconstruction, t: Transaction) => Promise<void> = null
    ): Promise<AtlasReconstruction> {
        if (!user?.canOperateReconstructionPipeline()) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const atlasReconstruction = await this.findOne({
                where: {reconstructionId: reconstructionId},
                lock: Transaction.LOCK.UPDATE,
                transaction: t
            });

            if (!atlasReconstruction) {
                throw new Error("No atlas reconstruction found for this reconstruction");
            }

            if (atlasReconstruction.status !== failed) {
                throw new GraphQLError(`This reconstruction is not waiting on ${phase}; its current phase has already moved on.`, {extensions: {code: 1004}});
            }

            const update = {status: pending, failureReason: null, failedAt: null};

            await atlasReconstruction.update(update, {transaction: t});

            await atlasReconstruction.recordEvent(kind, update, user, t);

            if (afterReset) {
                await afterReset(atlasReconstruction, t);
            }

            return atlasReconstruction;
        });
    }

    public static async requestDoiAssignment(user: User, reconstructionId: string): Promise<AtlasReconstruction> {
        return await this.requestPhaseRetry(
            user,
            reconstructionId,
            "DOI assignment",
            AtlasReconstructionStatus.FailedDoiAssignment,
            AtlasReconstructionStatus.PendingDoiAssignment,
            EventLogItemKind.AtlasReconstructionDoiAssignmentRequest
        );
    }

    public static async requestStructureAssignment(user: User, reconstructionId: string): Promise<AtlasReconstruction> {
        return await this.requestPhaseRetry(
            user,
            reconstructionId,
            "structure assignment",
            AtlasReconstructionStatus.FailedStructureAssignment,
            AtlasReconstructionStatus.PendingStructureAssignment,
            EventLogItemKind.AtlasReconstructionNodeStructureAssignmentRequest
        );
    }

    /**
     * The child reset alone would be inert: the precomputed service selects on Precomputed.status == Pending, which
     * updateGeneration left at FailedToLoad or FailedToGenerate.  This is the step requestSpecimenSpaceRegeneration
     * performs and the child reset it omits.
     */
    public static async requestPrecomputedRegeneration(user: User, reconstructionId: string): Promise<AtlasReconstruction> {
        return await this.requestPhaseRetry(
            user,
            reconstructionId,
            "precomputed regeneration",
            AtlasReconstructionStatus.FailedPrecomputed,
            AtlasReconstructionStatus.PendingPrecomputed,
            EventLogItemKind.AtlasReconstructionPrecomputedRequest,
            async (atlasReconstruction, t) => {
                const precomputed = await atlasReconstruction.getPrecomputed({transaction: t});

                if (!precomputed) {
                    throw new Error("No precomputed record found for this reconstruction");
                }

                await precomputed.requestGeneration(user, t);
            }
        );
    }

    /**
     * The child reset alone would be inert here too: the worker's QualityControl.getPending selects on that row, not on
     * the child, and assess left it at its failed result.
     */
    public static async requestQualityControlReassessment(user: User, reconstructionId: string): Promise<AtlasReconstruction> {
        return await this.requestPhaseRetry(
            user,
            reconstructionId,
            "quality control reassessment",
            AtlasReconstructionStatus.FailedQualityControl,
            AtlasReconstructionStatus.PendingQualityControl,
            EventLogItemKind.AtlasReconstructionQualityControlRequest,
            async (atlasReconstruction, t) => {
                const qualityControl = await QualityControl.findOne({where: {reconstructionId: atlasReconstruction.id}, transaction: t});

                if (!qualityControl) {
                    throw new Error("No quality control record found for this reconstruction");
                }

                await qualityControl.makePending(user, t);
            }
        );
    }

    /**
     * The child reset alone would be inert here as well, for a different reason: onAtlasReconstructionStatusChanged
     * only moves a parent it finds at Publishing, and the failure left this one at PublishFailed - so a retry that
     * reset only the child would index successfully and end with a Published child under a PublishFailed parent.
     */
    public static async requestSearchIndexing(user: User, reconstructionId: string): Promise<AtlasReconstruction> {
        return await this.requestPhaseRetry(
            user,
            reconstructionId,
            "search indexing",
            AtlasReconstructionStatus.FailedSearchIndexing,
            AtlasReconstructionStatus.PendingSearchIndexing,
            EventLogItemKind.AtlasReconstructionIndexingRequest,
            async (atlasReconstruction, t) => {
                const reconstruction = await Reconstruction.findByPk(atlasReconstruction.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

                if (!reconstruction) {
                    throw new Error("No reconstruction found for this atlas reconstruction");
                }

                await reconstruction.resumePublishing(user, t);
            }
        );
    }

    /**
     * Replays every automatic phase.  Admissible only from a failed phase or ReadyToPublish - the statuses a worker
     * never holds a claim on - and decided against the locked rows, because publish and the retries can all move them.
     * prepareToFinalize does the rewind; the DOI is deliberately not part of it, and assignDois recognises an
     * identifier it has already registered.
     *
     * No permission re-check inside the transaction: canOperateReconstructionPipeline does not depend on either
     * status, unlike the reject, discard and upload predicates.
     */
    public static async resetPipeline(user: User, reconstructionId: string): Promise<AtlasReconstruction> {
        if (!user?.canOperateReconstructionPipeline()) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const atlasReconstruction = await this.findOne({
                where: {reconstructionId: reconstructionId},
                lock: Transaction.LOCK.UPDATE,
                transaction: t
            });

            if (!atlasReconstruction) {
                throw new Error("No atlas reconstruction found for this reconstruction");
            }

            const reconstruction = await Reconstruction.findByPk(reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

            const resettable = AbandonableFailureStatuses.includes(atlasReconstruction.status)
                || atlasReconstruction.status === AtlasReconstructionStatus.ReadyToPublish;

            if (!resettable) {
                throw new GraphQLError(
                    `The automatic phases cannot be replayed for a reconstruction at ${AtlasReconstructionStatus[atlasReconstruction.status]}; they are only replayable from a failed phase or from ReadyToPublish.`,
                    {extensions: {code: 1004}}
                );
            }

            // Cleared here rather than in prepareToFinalize, which is also the first-approval path where it is already
            // null.
            await atlasReconstruction.update({nodeStructureAssignmentAt: null}, {transaction: t});

            await atlasReconstruction.prepareToFinalize(user, t);

            await atlasReconstruction.recordEvent(EventLogItemKind.AtlasReconstructionPipelineReset, {status: AtlasReconstructionStatus.PendingQualityControl}, user, t);

            if (reconstruction.status !== ReconstructionStatus.WaitingForAtlasReconstruction) {
                await reconstruction.resetToWaiting(user, t);
            }

            return atlasReconstruction;
        });
    }

    /**
     * Compare-and-set rather than a test on this.status: the instance was eager-loaded before publish opened its
     * transaction, and a pipeline reset or a reject can have moved the row since.  A stale ReadyToPublish would
     * otherwise overwrite a replay that had already been accepted.
     */
    public async tryStartPublishing(user: User, t: Transaction): Promise<boolean> {
        const update = {status: AtlasReconstructionStatus.PendingSearchIndexing};

        const [affected] = await AtlasReconstruction.update(update, {
            where: {id: this.id, status: AtlasReconstructionStatus.ReadyToPublish},
            transaction: t
        });

        if (affected !== 1) {
            debug(`tried to publish when not ready (current status: ${this.status})`);
            return false;
        }

        this.status = update.status;

        await this.recordEvent(EventLogItemKind.AtlasReconstructionIndexingRequest, update, user, t);

        return true;
    }

    public static async getIndexable(limit: number = null): Promise<AtlasReconstruction[]> {
        return AtlasReconstruction.findAll({
            where: {
                status: AtlasReconstructionStatus.PendingSearchIndexing
            },
            limit: limit,
        });
    }

    /**
     * Indexing has no external dependency - it is all database work - so it never reports ServiceUnavailable.  A
     * failure moves the parent to PublishFailed in the same transaction as the child's FailedSearchIndexing, so the
     * stuck reconstruction is distinguishable from one indexing normally rather than sitting at Publishing.  Nothing
     * is unwound: the archived predecessor stays archived, the DOIs are neither withdrawn nor repointed, and nothing
     * rewinds to ReadyToPublish.  Recovery is forward-only, through requestSearchIndexing.
     *
     * A transient is different - the claim is handed back and the item is retried on the next pass, so the parent is
     * left alone.
     */
    public async updateSearchIndex(user: User): Promise<PhaseOutcome> {
        try {
            await this.sequelize.transaction(async (t) => {
                const operation = new SearchIndexOperation(this);

                await operation.process(t);

                const now = Date.now();

                const update = {
                    status: AtlasReconstructionStatus.Published,
                    searchIndexedAt: now,
                    publishedAt: now,
                    failureReason: null,
                    failedAt: null
                }

                await this.update(update, {transaction: t});

                await this.recordEvent(EventLogItemKind.AtlasReconstructionIndexingComplete, update, user, t);

                const reconstruction = await this.getReconstruction({transaction: t});

                await reconstruction.onAtlasReconstructionStatusChanged(user, update.status, t);
            });

            return PhaseOutcome.Handled;
        } catch (error) {
            debug(`search indexing failed for ${this.id}: ${failureText(error)}`);

            if (isTransientDatabaseError(error)) {
                await this.release(AtlasReconstructionStatus.InSearchIndexing, AtlasReconstructionStatus.PendingSearchIndexing);

                return PhaseOutcome.Released;
            }

            // Loaded under the failure transaction and locked, not the instance getReconstruction would hand back:
            // both rows move together or neither does.  Child first, then parent - the same order resetPipeline uses.
            await this.recordPhaseFailure(user, AtlasReconstructionStatus.FailedSearchIndexing, phaseFailureMessage("search indexing", error), async (t) => {
                const reconstruction = await Reconstruction.findByPk(this.reconstructionId, {transaction: t, lock: Transaction.LOCK.UPDATE});

                await reconstruction?.onSearchIndexFailed(user, t);

                // States the invariant rather than fixing a leak: the rebuild above shares one transaction with the
                // status write, so a failure has already rolled its index rows back.  Saying it here is what lets every
                // route out of PublishFailed - the retry, and now reject - stay ignorant of the search index, and it
                // survives a refactor that moves SearchIndexOperation.process out of that transaction.
                await SearchIndex.destroy({where: {reconstructionId: this.id}, transaction: t});
            });

            return PhaseOutcome.Handled;
        }
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

        let reconstruction: AtlasReconstruction = null;

        try {
            reconstruction = await this.findByPk(id);
        } catch (err) {
            output.error = err.message;
            return output;
        }

        if (!reconstruction) {
            output.error = "reconstruction id not found";
            return output;
        }

        let tree: KDTree;

        let nodeId: string = null;

        if (this._nearestNodeCache.has(id)) {
            tree = this._nearestNodeCache.get(id);
        } else {
            const nodes = await reconstruction.getAtlasNodes();
            if (!this._nearestNodeCache.has(reconstruction.id)) {
                tree = new KDTree(nodes.map(n => n.toJSON()));
                this._nearestNodeCache.set(reconstruction.id, tree);
            } else {
                tree = this._nearestNodeCache.get(reconstruction.id);
            }
        }

        if (tree) {
            const result = tree.nearest({x: location[0], y: location[1], z: location[2]})

            if (result.length > 0) {
                nodeId = result[0].point.id;
            }
        }

        if (nodeId == null) {
            output.error = "could not identify nearest node";
            return output;
        }

        output.node = await AtlasNode.findByPk(nodeId);

        return output;
    }

    public static async toPortalFormat(user: User, atlasOrReconstructionId: string): Promise<PortalReconstruction> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }
        debug(`searching for atlas reconstruction ${atlasOrReconstructionId}`);

        const includes: any[] = [{
            model: User,
            as: "Reviewer"
        }];

        includes.push({
            model: Reconstruction,
            include: [{
                model: User,
                as: "Annotator"
            }, {
                model: User,
                as: "Reviewer"
            }, {
                model: User,
                as: "TeamReviewer"
            }, {
                model: Neuron,
                as: "Neuron",
                include: [{
                    model: Specimen,
                    as: "Specimen",
                    include: [{
                        model: Injection,
                        include: [{
                            model: InjectionVirus,
                        }, {
                            model: Fluorophore,
                        }]
                    }, {
                        model: Genotype,
                    }, {
                        model: Collection,
                    }]
                }]
            }]
        });

        let reconstruction = await AtlasReconstruction.findByPk(atlasOrReconstructionId, {
            include: includes.length > 0 ? includes : undefined
        });

        if (!reconstruction) {
            // Some context, such as the current Export service, only have access to the associated Atlas reconstruction id.  Allow it to be a fallback.
            debug(`toPortalFormat looking for specimen reconstruction ${atlasOrReconstructionId}`);
            const specimen = await Reconstruction.findByPk(atlasOrReconstructionId);

            if (!specimen) {
                debug(`not found`);
                return null;
            }

            debug(`toPortalFormat found specimen reconstruction ${atlasOrReconstructionId} as possible parent reconstruction`);

            reconstruction = await this.findOne({
                where: {
                    reconstructionId: specimen.id
                },
                include: includes.length > 0 ? includes : undefined
            });
        } else {
            debug(`toPortalFormat found atlas reconstruction ${atlasOrReconstructionId}`);
        }

        if (!reconstruction) {
            debug(`failed to find atlas reconstruction ${atlasOrReconstructionId}`);
            return null;
        }

        const nodes = await this.serializeNodes(user, reconstruction.id);

        return {
            id: reconstruction.id,
            annotationSpace: PortalAnnotationSpace.Atlas,
            doi: reconstruction.doi,
            neuron: reconstruction.Reconstruction.Neuron.toPortalFormat(),
            annotator: reconstruction.Reconstruction.Annotator?.toPortalFormat() ?? null,
            proofreader: reconstruction.Reviewer?.toPortalFormat() ?? null,
            peerReviewer: reconstruction.Reconstruction.Reviewer?.toPortalFormat() ?? null,
            teamReviewer: reconstruction.Reconstruction.TeamReviewer?.toPortalFormat() ?? null,
            nodes: nodes
        }
    }

    public static async serializeNodes(user: User, reconstructionId: string): Promise<PortalNode[]> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const options: FindOptions = {
            where: {reconstructionId: reconstructionId},
            include: [{
                model: NodeStructure,
            }, {
                model: AtlasStructure,
            }],
            order: [["index", "ASC"]]
        };

        const nodes = await AtlasNode.findAll(options);

        return nodes.map(n => {
            return {
                index: n.index,
                structure: NeuronStructure.swcStructureValue(n.neuronStructureId),
                x: n.x,
                y: n.y,
                z: n.z,
                radius: n.radius,
                parentIndex: n.parentIndex,
                atlasStructure: n.AtlasStructure?.structureId ?? null
            }
        });
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return AtlasReconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        sourceUrl: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        sourceComments: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        status: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        lengthMillimeters: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        doi: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        nodeCounts: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        nodeStructureAssignmentAt: DataTypes.DATE,
        searchIndexedAt: DataTypes.DATE,
        failureReason: {
            type: DataTypes.TEXT,
            defaultValue: null
        },
        failedAt: DataTypes.DATE,
        publishedAt: DataTypes.DATE
    }, {
        tableName: AtlasReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    AtlasReconstruction.belongsTo(User, {foreignKey: "reviewerId", as: "Reviewer"});
    AtlasReconstruction.belongsTo(Reconstruction, {foreignKey: "reconstructionId"});
    AtlasReconstruction.belongsTo(AtlasNode, {foreignKey: "somaNodeId", as: "Soma"});
    AtlasReconstruction.hasOne(QualityControl, {foreignKey: "reconstructionId"});
    AtlasReconstruction.hasOne(Precomputed, {foreignKey: "reconstructionId"});
    AtlasReconstruction.hasMany(AtlasNode, {foreignKey: "reconstructionId"});
};
