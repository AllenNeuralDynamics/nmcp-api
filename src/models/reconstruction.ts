import * as fs from "fs";

import {
    BelongsToGetAssociationMixin,
    DataTypes,
    FindOptions,
    HasManyGetAssociationsMixin,
    HasOneGetAssociationMixin,
    Includeable,
    Op,
    OrderItem,
    Sequelize,
    Transaction
} from "sequelize";

import {BaseModel} from "./baseModel";

import {SpecimenSpacePrecomputed} from "./specimenSpacePrecomputed";
import {mapToSpecimenNodeShape, SpecimenNode, SpecimenNodeShape} from "./specimenNode";
import {Neuron} from "./neuron";
import {User} from "./user";
import {GqlFile, UnauthorizedError} from "../graphql/secureResolvers";
import {ReconstructionTableName} from "./tableNames";
import {ReconstructionSpace} from "./reconstructionSpace";
import {Specimen} from "./specimen";
import {ReconstructionStatus} from "./reconstructionStatus";
import {AtlasReconstruction, AtlasReconstructionShape} from "./atlasReconstruction";
import {AtlasReconstructionStatus} from "./atlasReconstructionStatus";
import {EventLogItemKind, recordEvent} from "./eventLogItem";
import {isNotNullOrUndefined} from "../util/objectUtil";
import {NodeCounts, parseJsonFile, parseSwcFile, SimpleReconstruction} from "../io/simpleReconstruction";
import {NeuronStructure} from "./neuronStructure";
import {mapSpecimenNodes, PortalJsonReconstruction, PortalJsonReconstructionContainer} from "../io/portalJson";
import {Injection} from "./injection";
import {InjectionVirus} from "./injectionVirus";
import {Fluorophore} from "./fluorophore";
import {Genotype} from "./genotype";
import {Collection} from "./collection"
import {NodeStructure, NodeStructures} from "./nodeStructure";
import {GraphQLError} from "graphql/error";
import * as repl from "node:repl";
import {SearchIndex} from "./searchIndex";
import {Precomputed} from "./precomputed";

const debug = require("debug")("nmcp:nmcp-api:reconstruction");

export type ReconstructionsQueryArgs = {
    status: ReconstructionStatus[];
    offset: number;
    limit: number;
    userOnly?: boolean;
    userId?: string;
    specimenIds?: string[];
    keywords?: string[];
}

export type ReconstructionQueryResponse = {
    total: number;
    offset: number;
    reconstructions: Reconstruction[];
}

export type PublishedReconstructionQueryResponse = {
    total: number;
    offset: number;
    reconstructions: AtlasReconstruction[];
}

export type ReviewRequestArgs = {
    reconstructionId: string
    targetStatus: ReconstructionStatus.PeerReview | ReconstructionStatus.PublishReview;
    duration?: number;
    notes?: string;
}

export type ReconstructionMetadataArgs = {
    reconstructionId: string;
    duration?: number;
    notes?: string;
    started?: Date;
    completed?: Date;
}

export type ReconstructionUploadArgs = {
    reconstructionId: string;
    reconstructionSpace: ReconstructionSpace
    file: Promise<GqlFile>;
}

export enum ReconstructionRevisionKind {
    SpecimenSpace = 0,
    AtlasSpace = 1
}

class UploadError extends Error {
    public constructor(message: string) {
        super(message);
    }
}

class NotFoundError extends Error {
    public constructor(message: string) {
        super(message);
    }
}

type ReconstructionShape = {
    id?: string;
    sourceUrl?: string;
    sourceComments?: string;
    status?: ReconstructionStatus;
    notes?: string;
    durationHours?: number;
    specimenLengthMillimeters?: number;
    specimenNodeCounts?: NodeCounts;
    startedAt?: Date;
    completedAt?: Date;
    reviewedAt?: Date;
    approvedAt?: Date;
    publishedAt?: Date;
    archivedAt?: Date;
    specimenSomaNodeId?: string;
    annotatorId?: string;
    reviewerId?: string;
    neuronId?: string;
}

export class Reconstruction extends BaseModel {
    public sourceUrl: string;
    public sourceComments: string;
    public status: ReconstructionStatus;
    public notes: string;
    public durationHours: number;
    public specimenLengthMillimeters: number;
    public specimenNodeCounts: NodeCounts;
    public startedAt: Date;
    public completedAt: Date;
    public reviewedAt: Date;    // Peer review timestamp (specimen-space data)
    public approvedAt: Date;    // Publish review timestamp (atlas-space data)
    public publishedAt: Date;
    public archivedAt: Date;
    public specimenSomaNodeId: string;
    public annotatorId: string;
    public reviewerId: string;
    public neuronId: string;

    public getNodes!: HasManyGetAssociationsMixin<SpecimenNode>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;
    public getSoma!: BelongsToGetAssociationMixin<SpecimenNode>;
    public getAnnotator!: BelongsToGetAssociationMixin<User>;
    public getReviewer!: BelongsToGetAssociationMixin<User>;
    public getAtlasReconstruction!: HasOneGetAssociationMixin<AtlasReconstruction>;
    public getPrecomputed!: HasOneGetAssociationMixin<SpecimenSpacePrecomputed>;

    public Neuron?: Neuron;
    public Nodes?: SpecimenNode[];
    public Annotator?: User;
    public Reviewer?: User;
    public AtlasReconstruction?: AtlasReconstruction;

    protected static override defaultSort(): OrderItem[] {
        return [["Neuron", "Specimen", "label", "ASC"], ["Neuron", "label", "ASC"]];
    }

    private async recordEvent(kind: EventLogItemKind, details: ReconstructionShape, user: User, t: Transaction, substituteUser: User = null): Promise<void> {
        await recordEvent({
            kind: kind,
            targetId: this.id,
            parentId: this.neuronId,
            details: details,
            userId: user.id,
            substituteUserId: substituteUser?.id
        }, t);
    }

    private static async createWithTransaction(user: User, shape: ReconstructionShape, t: Transaction, substituteUser: User): Promise<Reconstruction> {
        const reconstruction = await this.create(shape, {transaction: t});

        await reconstruction.recordEvent(EventLogItemKind.ReconstructionCreate, shape, user, t, substituteUser);

        return reconstruction;
    }

    public static async createForShape(user: User, shape: ReconstructionShape, t: Transaction = null, substituteUser: User = null): Promise<Reconstruction> {
        if (t === null) {
            return await this.sequelize.transaction(async (t) => {
                return await this.createWithTransaction(user, shape, t, substituteUser);
            })
        } else {
            return await this.createWithTransaction(user, shape, t, substituteUser);
        }
    }

    private async updateWithTransaction(user: User, update: ReconstructionShape, t: Transaction, substituteUser: User = null) {
        const r = await this.update(update, {transaction: t});

        await this.recordEvent(EventLogItemKind.ReconstructionUpdate, update, user, t, substituteUser);

        return r;
    }

    public static async getAll(user: User, args: ReconstructionsQueryArgs, include: Includeable[] = [], disregardAuth: boolean = false): Promise<ReconstructionQueryResponse> {
        if (!disregardAuth && !user?.canViewReconstructions()) {
            throw new UnauthorizedError();
        }

        let out: ReconstructionQueryResponse = {
            offset: 0,
            total: 0,
            reconstructions: []
        };

        const specimenInclude = [{model: Neuron, as: "Neuron", include: [{model: Specimen, as: "Specimen"}]}];

        let options: FindOptions = args.userOnly ? {where: {annotatorId: args.userId}, include: []} : {where: {}, include: []};

        if (args.status && args.status.length > 0) {
            options.where[Op.or] = args.status.map(f => {
                return {status: f};
            })
        }

        options["include"] = [...specimenInclude, ...include];

        if (args.specimenIds && args.specimenIds.length > 0) {
            options.where["$Neuron.Specimen.id$"] = {[Op.in]: args.specimenIds}
        }

        out.total = await this.setSortAndLimiting(options, args);
        out.offset = options.offset;

        out.reconstructions = await Reconstruction.findAll(options);

        return out;
    }

    public static async getAllPublished(user: User, offset: number = 0, limit: number = null): Promise<PublishedReconstructionQueryResponse> {
        const include = [{model: AtlasReconstruction, include: [{model: Precomputed}]}];

        const response = await Reconstruction.getAll(user, {offset: offset, limit: limit, status: [ReconstructionStatus.Published]}, include, true);

        return {
            total: response.total,
            offset: response.offset,
            reconstructions: response.reconstructions.map(r => r.AtlasReconstruction)
        }
    }

    public static async findOrOpenReconstruction(neuronId: string, user: User, substituteUser: User = null): Promise<Reconstruction> {
        if (!user?.canViewReconstructions()) {
            throw new UnauthorizedError();
        }

        const existing = await Reconstruction.findOne({
            where: {
                annotatorId: user.id,
                neuronId: neuronId,
            }
        });

        if (existing) {
            return existing;
        }

        const [reconstruction, _] = await this.openReconstruction(neuronId, user, null, substituteUser);

        return reconstruction;
    }

    public static async updateMetadata(userOrId: User | string, args: ReconstructionMetadataArgs): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(args.reconstructionId, userOrId);

        if (!user?.canModifyReconstruction()) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const update = {};

            if (args.duration !== undefined) {
                update["durationHours"] = args.duration;
            }

            if (args.started !== undefined) {
                update["notes"] = args.notes ?? "";
            }

            if (args.started !== undefined) {
                update["startedAt"] = args.started;
            }

            if (args.completed !== undefined) {
                update["completedAt"] = args.completed;
            }

            if (Object.keys(update).length == 0) {
                return;
            }

            return await reconstruction.updateWithTransaction(user, update, t);
        });
    }

    public static async openReconstructionRevision(userOrId: User | string, reconstructionId: string, revisionKind: ReconstructionRevisionKind): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        if (!user?.canReviseReconstruction()) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            debug(`creating revision for ${reconstruction.id}`);

            const [revision, isExisting] = await this.openReconstruction(reconstruction.neuronId, user, t);

            if (isExisting) {
                return null;
            }

            if (revisionKind == ReconstructionRevisionKind.AtlasSpace) {
                debug(`applying specimen-space data from ${reconstruction.id} to ${revision.id}`);
                await revision.copyFrom(reconstruction, user, t);
            }

            return revision;
        });
    }

    public async onAtlasReconstructionStatusChanged(user: User, status: AtlasReconstructionStatus, t: Transaction) {
        if (status == AtlasReconstructionStatus.ReadyToPublish) {
            if (this.status == ReconstructionStatus.WaitingForAtlasReconstruction) {
                const update = {status: ReconstructionStatus.ReadyToPublish};
                await this.update(update, {transaction: t});
                await this.recordEvent(EventLogItemKind.ReconstructionFinalizeApprove, update, user, t);
            } else {
                // TODO SystemError
                debug(`received unexpected atlas reconstruction status update: ${status} (current status: ${this.status})`);
            }
        } else if (status == AtlasReconstructionStatus.Published) {
            if (this.status == ReconstructionStatus.Publishing) {
                const update = {status: ReconstructionStatus.Published, publishedAt: this.publishedAt ?? new Date()};
                await this.update(update, {transaction: t});
                await this.recordEvent(EventLogItemKind.ReconstructionPublished, update, user, t);
            } else {
                // TODO SystemError
                debug(`received unexpected atlas reconstruction status update: ${status} (current status: ${this.status})`);
            }
        }
    }

    public static async openReconstruction(neuronId: string, userOrId: string | User, transaction: Transaction = null, substituteUser: User = null): Promise<[Reconstruction, boolean]> {
        const user = await User.findUserOrId(userOrId);

        if (!user?.canAnnotate()) {
            throw new UnauthorizedError();
        }

        const ownTransaction = transaction == null;

        const t = ownTransaction ? await Reconstruction.sequelize.transaction() : transaction;

        try {
            // A user cannot open a new reconstruction if they have one that is not in a finalized state such as published or archived.
            const whereStatus = {status: {[Op.notIn]: [ReconstructionStatus.Published, ReconstructionStatus.Archived, ReconstructionStatus.Discarded]}};

            const existingReconstruction = await Reconstruction.findOne({
                where: {
                    annotatorId: user.id,
                    neuronId: neuronId,
                    ...whereStatus,
                }, transaction: t
            });

            if (existingReconstruction) {
                return [existingReconstruction, true];
            }

            const shape: ReconstructionShape = {
                neuronId: neuronId,
                annotatorId: user.id,
                status: ReconstructionStatus.InProgress,
                startedAt: new Date()
            };

            const reconstruction = await Reconstruction.createWithTransaction(user, shape, t, substituteUser);

            const atlasShape: AtlasReconstructionShape = {
                status: AtlasReconstructionStatus.Initialized,
                reconstructionId: reconstruction.id,
            };

            await AtlasReconstruction.createForShape(user, atlasShape, t, substituteUser);

            if (ownTransaction) {
                await t.commit();
            }

            return [reconstruction, false];
        } catch (err) {
            if (ownTransaction) {
                await t.rollback();
            }

            throw err;
        }
    }

    private static async findReconstructionAndUser(id: string, userOrId: User | string, include: FindOptions["include"] = [], allowNoUser: boolean = false): Promise<[Reconstruction, User]> {
        const reconstruction = await Reconstruction.findByPk(id, {include: include});

        if (!reconstruction) {
            throw new NotFoundError(`Reconstruction ${id} does not exist`);
        }

        const user = await User.findUserOrId(userOrId);

        if (!allowNoUser && !user) { // TODO Remove (along with method arg) once approve doesn't need an automation bypass.
            // Don't reveal too much information about users/not users.
            throw new UnauthorizedError();
        }

        return [reconstruction, user];
    }

    public static async pauseReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        if (!user?.canPauseReconstruction(reconstruction.annotatorId)) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const update = {status: ReconstructionStatus.OnHold};

            const r = await reconstruction.update(update, {transaction: t});

            await r.recordEvent(EventLogItemKind.ReconstructionPause, update, user, t, substituteUser);

            return r;
        });
    }

    public static async resumeReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        if (!user?.canResumeReconstruction(reconstruction.annotatorId)) {
            throw new UnauthorizedError();
        }

        return await this.sequelize.transaction(async (t) => {
            const update = {status: ReconstructionStatus.InProgress};

            const r = await reconstruction.update(update, {transaction: t});

            await r.recordEvent(EventLogItemKind.ReconstructionResume, update, user, t, substituteUser);

            return r;
        });
    }

    public static async requestReview(args: ReviewRequestArgs, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        const {reconstructionId, targetStatus, duration, notes} = args;

        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        if (targetStatus != ReconstructionStatus.PeerReview && targetStatus != ReconstructionStatus.PublishReview) {
            throw new Error("Requested status must be Peer Review or Publish Review")
        }

        // TODO When the SmartSheet import is no longer required, remove disregardAuth and don't allow the possibility of overriding. disregardAuth is needed
        //  because SmartSheets contain people as reviewers that we need to make as users in the system, but should not be auto-granted review permissions in
        //  the portal.
        if (!disregardAuth && !user?.canRequestReview(reconstruction.annotatorId, reconstruction.status, targetStatus)) {
            throw new UnauthorizedError();
        }

        const update = {
            status: targetStatus,
            completedAt: new Date()
        }

        if (isNotNullOrUndefined(duration)) {
            update["duration"] = duration;
        }

        if (isNotNullOrUndefined(notes)) {
            update["notes"] = notes;
        }

        return await this.sequelize.transaction(async (t) => {
            const r = await reconstruction.update(update, {transaction: t});

            const kind = targetStatus == ReconstructionStatus.PeerReview ? EventLogItemKind.ReconstructionRequestPeerReview : EventLogItemKind.ReconstructionRequestPublishReview;

            await r.recordEvent(kind, update, user, t, substituteUser);

            return r;
        });
    }

    public static async approveReconstruction(id: string, targetStatus: ReconstructionStatus, userOrId: User | string, substituteUser: User = null, disregardAuth: boolean = false): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId, [], true);

        // TODO When the SmartSheet import is no longer required, remove disregardAuth and don't allow the possibility of overriding. disregardAuth is needed
        //  because SmartSheets contain people as reviewers that we need to make as users in the system, but should not be auto-granted review permissions in
        //  the portal.
        // At least block for peer review which is not a part of import.
        if (disregardAuth && targetStatus == ReconstructionStatus.PublishReview) {
            throw new UnauthorizedError();
        }
        if (!disregardAuth && !user?.canApproveReconstruction(targetStatus)) {
            throw new UnauthorizedError();
        }

        // TODO - not enough checks that the current status is correct for the request.  Relies on UI at the moment.

        // status argument is the desired status after approval.
        if (targetStatus != ReconstructionStatus.PublishReview && targetStatus != ReconstructionStatus.Approved) {
            throw new Error("Requested approval status is not supported")
        }

        return await this.sequelize.transaction(async (t) => {
            if (targetStatus == ReconstructionStatus.PublishReview) {
                // Peer review is being approved.
                const update = {status: ReconstructionStatus.PublishReview, reviewerId: user.id, reviewedAt: new Date()};

                const r = await reconstruction.update(update, {transaction: t});

                await r.recordEvent(EventLogItemKind.ReconstructionApprovePeerReview, update, user, t, substituteUser);

                return r;
            } else {
                // Publish review is being approved.
                const update = {status: ReconstructionStatus.Approved, approvedAt: new Date()};

                let r = await reconstruction.update(update, {transaction: t});

                await r.recordEvent(EventLogItemKind.ReconstructionApprovePublishReview, update, user, t, substituteUser);

                // If other requirements are met, move to finalizing.
                const atlasReconstruction = await reconstruction.getAtlasReconstruction();

                if (await atlasReconstruction.approve(user, t, substituteUser)) {
                    const update = {status: ReconstructionStatus.WaitingForAtlasReconstruction};

                    r = await reconstruction.update(update, {transaction: t});
                }

                return r;
            }
        });
    }

    public static async rejectReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        if (!user?.canRejectReconstruction(reconstruction.status)) {
            throw new UnauthorizedError();
        }

        if (reconstruction.status != ReconstructionStatus.PeerReview && reconstruction.status != ReconstructionStatus.PublishReview) {
            throw new Error("Requested status must be Peer Review or Publish Review")
        }

        const update = {
            status: ReconstructionStatus.Rejected
        };

        if (reconstruction.status == ReconstructionStatus.PeerReview) {
            update["reviewerId"] = user.id;
        }

        return await this.sequelize.transaction(async (t) => {
            const r = await reconstruction.update(update, {transaction: t});

            await r.recordEvent(EventLogItemKind.ReconstructionReject, update, user, t, substituteUser);

            if (reconstruction.status == ReconstructionStatus.PublishReview) {
                const atlasReconstruction = await reconstruction.getAtlasReconstruction();
                await atlasReconstruction.reject(user, t);
            }

            return r;
        });
    }

    public static async publish(userOrId: User, reconstructionId: string, replaceExisting: boolean = false): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId, [{model: AtlasReconstruction}]);

        if (!user?.canPublish()) {
            throw new UnauthorizedError();
        }

        if (!reconstruction) {
            throw new Error("The reconstruction could not be found");
        }

        if (reconstruction.AtlasReconstruction.nodeCounts == null || reconstruction.status != ReconstructionStatus.ReadyToPublish) {
            throw new Error("The reconstruction is not in a publishable state");
        }

        return await this.sequelize.transaction(async (t) => {
            return await reconstruction.publishWithTransaction(user, replaceExisting, t);
        });
    }

    private async publishWithTransaction(user: User, replaceExisting: boolean, t: Transaction): Promise<Reconstruction> {
        const existingPublished = await Reconstruction.findOne({where: {neuronId: this.neuronId, status: ReconstructionStatus.Published}});

        if (existingPublished) {
            if (!replaceExisting) {
                throw new GraphQLError("This neuron has an existing published reconstruction.", {extensions: {code: 1001}});
            }

            await existingPublished.archivePublished(user, t);
        }

        if (!(await this.AtlasReconstruction.tryStartPublishing(user, t))) {
            throw new Error("The associated atlas reconstruction is not in a publishable state");
        }

        const update = {status: ReconstructionStatus.Publishing};

        const updated = await this.update(update, {transaction: t});

        await updated.recordEvent(EventLogItemKind.ReconstructionPublishing, update, user, t);

        return updated;
    }

    public static async publishAll(user: User, reconstructionIds: string[]): Promise<Reconstruction[]> {
        if (!user?.canPublish()) {
            throw new UnauthorizedError();
        }

        let reconstructions: Reconstruction[];

        if (reconstructionIds.length == 1 && reconstructionIds[0] == "ALL") {
            reconstructions = await this.findAll({where: {status: ReconstructionStatus.ReadyToPublish}, include: [{model: AtlasReconstruction}]});
        } else {
            if (reconstructionIds.length > 100) {
                throw new Error("Bulk publishing is limited to 100 reconstructions per request");
            }
            reconstructions = await this.findAll({where: {id: {[Op.in]: reconstructionIds}}, include: [{model: AtlasReconstruction}]});
        }

        return await this.sequelize.transaction(async (t) => {
            const updated = [];

            for (const r of reconstructions) {
                updated.push(await r.publishWithTransaction(user, false, t));
            }

            return updated;
        });
    }

    public static async discardReconstruction(id: string, userOrId: User | string, substituteUser: User = null): Promise<Reconstruction> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(id, userOrId);

        if (!user?.canDiscardReconstruction(reconstruction.annotatorId)) {
            throw new UnauthorizedError();
        }

        // TODO This should be more sophisticated in the behavior and the response.  Annotators can discard when in peer review or lower.  Admins should be able
        // to discard ones in review.  Published or Archived can never be removed.
        if (reconstruction.status == ReconstructionStatus.Published || reconstruction.status == ReconstructionStatus.PublishReview || reconstruction.status == ReconstructionStatus.Archived) {
            throw new Error(`Cannot discard a reconstruction with status ${ReconstructionStatus[reconstruction.status]}.`)
        }

        return await Reconstruction.sequelize.transaction(async (t) => {
            await AtlasReconstruction.discardForReconstruction(user, reconstruction.id, t);

            await SpecimenNode.destroy({
                where: {
                    reconstructionId: reconstruction.id
                }, transaction: t
            });

            const update = {status: ReconstructionStatus.Discarded};

            await reconstruction.update(update, {transaction: t});

            await reconstruction.destroy({transaction: t});

            await reconstruction.recordEvent(EventLogItemKind.ReconstructionDiscard, update, user, t, substituteUser);

            return reconstruction;
        });
    }

    private static async validateUploadArgs(args: ReconstructionUploadArgs): Promise<UploadError | null> {
        if (!args.file) {
            return new UploadError("The JSON or SWC file is missing.");
        }

        return null;
    }

    public static async fromJsonUpload(userOrId: User | string, args: ReconstructionUploadArgs): Promise<Reconstruction> {
        await Reconstruction.validateUploadArgs(args);

        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(args.reconstructionId, userOrId);

        if (!user.canUploadReconstructionData(args.reconstructionSpace)) {
            throw new UnauthorizedError();
        }

        const file: any = await args.file;

        const reconstructionData = await parseJsonFile(file.filename, file.createReadStream());

        await reconstruction.fromParsedStructures(user, args.reconstructionSpace, reconstructionData);

        return await Reconstruction.findByPk(args.reconstructionId);
    }

    public static async fromSwcUpload(userOrId: User | string, args: ReconstructionUploadArgs): Promise<Reconstruction> {
        await Reconstruction.validateUploadArgs(args);

        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(args.reconstructionId, userOrId);

        if (!user.canUploadReconstructionData(args.reconstructionSpace)) {
            throw new UnauthorizedError();
        }

        const file: any = await args.file;

        const reconstructionData = await parseSwcFile(file.filename, file.createReadStream());

        await reconstruction.fromParsedStructures(user, args.reconstructionSpace, reconstructionData);

        return await Reconstruction.findByPk(args.reconstructionId);
    }

    public static async fromJsonFile(userOrId: User | string, reconstructionId: string, sourceFile: string, space: ReconstructionSpace, substituteUser: User): Promise<void> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        const reconstructionData = await parseJsonFile(sourceFile, fs.createReadStream(sourceFile));

        await reconstruction.fromParsedStructures(user, space, reconstructionData, substituteUser);
    }

    public static async fromSwcFile(userOrId: User | string, reconstructionId: string, sourceFile: string, space: ReconstructionSpace, substituteUser: User): Promise<void> {
        const [reconstruction, user] = await Reconstruction.findReconstructionAndUser(reconstructionId, userOrId);

        const reconstructionData = await parseSwcFile(sourceFile, fs.createReadStream(sourceFile));

        await reconstruction.fromParsedStructures(user, space, reconstructionData, substituteUser);
    }

    public static async getAsJSONForAtlasId(user: User, atlasId: string): Promise<PortalJsonReconstructionContainer | null> {
        if (!user?.canRequestReconstructionData()) {
            throw new UnauthorizedError();
        }

        const includes = [{
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
        }];

        const atlas = await AtlasReconstruction.findByPk(atlasId);

        if (!atlas) {
            return null;
        }

        const reconstruction = await this.findByPk(atlas.reconstructionId, {
            include: includes.length > 0 ? includes : undefined
        });

        if (!reconstruction) {
            return null;
        }
        const result: PortalJsonReconstructionContainer = {
            comment: "",
            neurons: []
        };

        let soma = await reconstruction.getSoma();

        const label = reconstruction.Neuron.Specimen.Injections.map(i => ({
            virus: i.InjectionVirus?.name ?? "",
            fluorophore: i.Fluorophore?.name ?? ""
        }));

        const data: PortalJsonReconstruction = {
            id: reconstruction.Neuron.id,
            idString: reconstruction.Neuron.label,
            DOI: null,
            sample: reconstruction.Neuron.Specimen.toPortalJson(),
            label: label.length > 0 ? label[0] : null,
            annotationSpace: null,
            annotator: null,
            proofreader: null,
            peerReviewer: null,
            soma: soma.toJSON() ?? null,
            axonId: reconstruction.id,
            dendriteId: reconstruction.id
        };

        function nodeWhere(structureId: string) {
            return {
                reconstructionId: reconstruction.id,
                neuronStructureId: {
                    [Op.in]: [NeuronStructure.SomaNeuronStructureId, structureId]
                }
            }
        }

        let options: FindOptions = {
            where: nodeWhere(NeuronStructure.AxonStructureId),
            include: [{
                model: NodeStructure,
            }],
            order: [["index", "ASC"]]
        };

        const axonNodes = await SpecimenNode.findAll(options);

        data.axon = mapSpecimenNodes(axonNodes, NodeStructures.axon);
        data.axon[0].structureIdentifier = NodeStructures.soma;

        options = {
            where: nodeWhere(NeuronStructure.DendriteStructureId),
            include: [{
                model: NodeStructure
            }],
            order: [["index", "ASC"]]
        };

        const dendriteNodes = await SpecimenNode.findAll(options);

        data.dendrite = mapSpecimenNodes(dendriteNodes, NodeStructures.basalDendrite);
        data.dendrite[0].structureIdentifier = NodeStructures.soma;

        result.neurons.push(data);

        return result;
    }

    private async archivePublished(user: User, t: Transaction): Promise<void> {
        const shape = {
            status: ReconstructionStatus.Archived,
            archivedAt: new Date(),
        };

        await this.update(shape, {transaction: t});


        const atlasReconstruction = await this.getAtlasReconstruction();

        if (atlasReconstruction) {
            await SearchIndex.destroy({
                where: {reconstructionId: atlasReconstruction.id},
                transaction: t
            });
        }

        await this.recordEvent(EventLogItemKind.ReconstructionArchive, shape, user, t);
    }

    /*
     * Copies the specimen-space properties from the source reconstruction to this reconstruction instance.  This is primarily for creating revisions to
     * neuron reconstructions that will only change the atlas-space reconstruction information and saves the user the step of re-uploading or applying
     * specimen-space metadata and reconstruction data.
     */
    private async copyFrom(source: Reconstruction, user: User, t: Transaction): Promise<void> {
        const nodes = await SpecimenNode.findAll({
            where: {
                reconstructionId: source.id
            },
            transaction: t
        });

        const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

        for (let idx = 0; idx < nodes.length; idx += chunkSize) {
            const nodeData = nodes.slice(idx, idx + chunkSize).map(n => {
                const obj = n.toJSON();
                obj.id = undefined;
                obj.reconstructionId = this.id;
                return obj;
            });

            await SpecimenNode.bulkCreate(nodeData, {transaction: t});
        }

        const soma = await SpecimenNode.findOne({
            where: {
                reconstructionId: this.id,
                index: 1
            },
            transaction: t
        });

        const shape = {
            status: ReconstructionStatus.InProgress,
            sourceUrl: source.sourceUrl,
            sourceComments: source.sourceComments,
            notes: source.notes,
            durationHours: source.durationHours,
            specimenLengthMillimeters: source.specimenLengthMillimeters,
            specimenNodeCounts: source.specimenNodeCounts,
            specimenSomaNodeId: soma?.id
        };

        await this.update(shape, {transaction: t});

        const precomputed = await SpecimenSpacePrecomputed.createForReconstruction(user, this.id, t);

        await precomputed.requestGeneration(user, t);
    }

    private async fromParsedStructures(user: User, space: ReconstructionSpace, reconstructionData: SimpleReconstruction, substituteUser: User = null): Promise<Reconstruction> {
        // TODO allow for soma in axon or dendrite.  replaceNodes in both reconstruction types would need to be updated.
        const soma = reconstructionData.axon.soma ?? reconstructionData.dendrite.soma;


        if (!soma) {
            throw new UploadError("A soma was not found in the uploaded file.");
        }

        // TODO also check soma x, y, z are the same within some tolerance.

        return await this.sequelize.transaction(async (t) => {
            if (space == ReconstructionSpace.Specimen) {
                if (this.status != ReconstructionStatus.PeerReview && this.status != ReconstructionStatus.PublishReview && !user?.isAdmin()) {
                    throw new Error("The reconstruction data can not be modified when not in peer or publish review");
                }

                const updated = await this.replaceNodeData(user, reconstructionData, t);

                let precomputed = await SpecimenSpacePrecomputed.findOne({where: {reconstructionId: this.id}});

                if (!precomputed) {
                    precomputed = await SpecimenSpacePrecomputed.createForReconstruction(user, this.id, t);
                }

                await precomputed.requestGeneration(user, t);

                return updated;
            }

            if (this.status != ReconstructionStatus.PublishReview) {
                throw new Error("The reconstruction data can not be modified when not in publish review");
            }

            const atlasReconstruction = await this.getAtlasReconstruction();

            if (!atlasReconstruction) {
                throw new UploadError(`Atlas reconstruction for ${this.id} not found.`)
            }

            await atlasReconstruction.replaceNodeData(user, reconstructionData, t);

            const neuron = await this.getNeuron({transaction: t});

            if (neuron.atlasSoma.x < 0.01 || neuron.atlasSoma.y < 0.01 || neuron.atlasSoma.z < 0.01) {
                const soma = await atlasReconstruction.getSoma({transaction: t});

                await neuron.update({atlasSoma: {x: soma.x, y: soma.y, z: soma.z}}, {transaction: t});
            }
        });
    }

    private async replaceNodeData(user: User, reconstructionData: SimpleReconstruction, t: Transaction): Promise<Reconstruction> {
        try {
            await this.update({specimenSomaNodeId: null, transaction: t});

            await SpecimenNode.destroy({
                where: {reconstructionId: this.id},
                transaction: t
            });

            for (const s of [reconstructionData.axon, reconstructionData.dendrite]) {
                const nodeData: SpecimenNodeShape[] = s.getNonSomaNodes().map(node => mapToSpecimenNodeShape(node, s.NeuronStructureId, this.id));

                const chunkSize = AtlasReconstruction.PreferredDatabaseChunkSize;

                for (let idx = 0; idx < nodeData.length; idx += chunkSize) {
                    await SpecimenNode.bulkCreate(nodeData.slice(idx, idx + chunkSize), {transaction: t});
                }
            }

            const somaShape = mapToSpecimenNodeShape(reconstructionData.axon.soma, NeuronStructure.SomaNeuronStructureId, this.id);

            const soma = await SpecimenNode.create(somaShape, {transaction: t});

            const updated = await this.update({
                sourceUrl: reconstructionData.source,
                sourceComments: reconstructionData.comments,
                specimenNodeCounts: {axon: reconstructionData.axon.nodeCounts, dendrite: reconstructionData.dendrite.nodeCounts},
                specimenSomaNodeId: soma?.id
            }, {transaction: t});

            await this.recordEvent(EventLogItemKind.ReconstructionUpload, null, user, t);

            return updated;
        } catch (err) {
            throw err;
        }
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return Reconstruction.init({
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
        notes: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        durationHours: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        specimenLengthMillimeters: {
            type: DataTypes.DOUBLE,
            defaultValue: null
        },
        specimenNodeCounts: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE,
        reviewedAt: DataTypes.DATE,
        approvedAt: DataTypes.DATE,
        publishedAt: DataTypes.DATE,
        archivedAt: DataTypes.DATE
    }, {
        tableName: ReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    Reconstruction.belongsTo(Neuron, {foreignKey: "neuronId"});
    Reconstruction.belongsTo(User, {foreignKey: "annotatorId", as: "Annotator"});
    Reconstruction.belongsTo(User, {foreignKey: "reviewerId", as: "Reviewer"});
    Reconstruction.belongsTo(SpecimenNode, {foreignKey: "specimenSomaNodeId", as: "Soma"});
    Reconstruction.hasMany(SpecimenNode, {foreignKey: "reconstructionId"});
    Reconstruction.hasOne(SpecimenSpacePrecomputed, {foreignKey: "reconstructionId", as: "Precomputed"});
    Reconstruction.hasOne(AtlasReconstruction, {foreignKey: "reconstructionId"});
};
