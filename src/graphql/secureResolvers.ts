import {Neuron, NeuronBulkUpdateShape, NeuronQueryInput, NeuronShape} from "../models/neuron";

import {Genotype} from "../models/genotype";
import {CandidateImportOptions, Specimen, SpecimenShape} from "../models/specimen";
import {EntityQueryOutput} from "../models/baseModel";
import {Injection, InjectionShape, InjectionQueryInput} from "../models/injection";
import {User, UserPermissions, UserQueryInput} from "../models/user";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {AtlasReconstructionStatus, PhaseFailureStatuses} from "../models/atlasReconstructionStatus";
import {GraphQLError} from "graphql/error";
import {Collection, CollectionShape} from "../models/collection";
import {Issue, IssueReference, IssueResolutionKind, IssueStatus} from "../models/issue";
import {
    ReconstructionUploadArgs,
    AnnotationQueryResponse,
    AnnotationsQueryArgs,
    ReviewRequestArgs,
    Annotation,
    AnnotationMetadataArgs, ReconstructionRevisionKind
} from "../models/annotation";
import {SpecimenSpaceReconstruction} from "../models/specimenSpaceReconstruction";
import {RawReconstruction} from "../models/rawReconstruction";
import {
    publishesQualityControlDocument,
    RawReconstructionUpload,
    RawReconstructionUploadArgs
} from "../models/rawReconstructionUpload";
import GraphQLUpload = require("graphql-upload/GraphQLUpload.js");
import {AtlasQualityControl} from "../models/atlasQualityControl";
import {AtlasNode} from "../models/atlasNode";
import {SpecimenNode} from "../models/specimenNode";
import {Precomputed} from "../models/precomputed";
import {NodeStructure} from "../models/nodeStructure";
import {SpecimenSpacePrecomputed} from "../models/specimenSpacePrecomputed";
import {EventLogItem} from "../models/eventLogItem";
import {ApiKey} from "../models/apiKey";
import {AccessRequest, AccessRequestQueryInput, AccessRequestStatus} from "../models/accessRequest";
import {FieldResolvers, RequestContext} from "./requestContext";
import {rawUploadQualityControlUrl} from "../io/rawQualityControlFiles";

export class UnauthorizedError extends GraphQLError {
    public constructor() {
        super("User is not authenticated", {
            extensions: {
                code: "FORBIDDEN",
                http: {status: 401},
            },
        })
    }
}

//
// GraphQL arguments
//

export interface GqlFile {
    filename: string;
    encoding: string;
    mimetype: string;
    stream: any;
}

/**
 * The Annotation.phaseFailure payload: the child's Failed... status, what it recorded, and when.  Derived from
 * the atlas reconstruction on every read rather than persisted on the parent, so there is no second copy to drift.
 */
export interface PhaseFailureShape {
    phase: AtlasReconstructionStatus;
    reason: string | null;
    failedAt: Date | null;
}

// noinspection JSUnusedGlobalSymbols
/**
 * All resolvers/functionality that requires any form of authorization except for internal-only.  Any query or mutation must enforce some level authorization
 * above UserPermissions.None. Functionality that is allowed to be used without authentication or authorization (e.g., basic viewer use) should be in
 * openResolvers.ts.  Functionality that should only be authorized to other internal services and not to a remote client should be in internalResolvers.ts.
 */
export const secureResolvers = {
    Upload: GraphQLUpload,

    Query: {
        users(_: any, args: { input: UserQueryInput }, {user}: RequestContext): Promise<EntityQueryOutput<User>> {
            if (user.permissions & UserPermissions.Admin) {
                return User.getAll(args.input);
            }

            throw new UnauthorizedError();
        },

        genotype(_: any, args: { id: string }, {user}: RequestContext): Promise<Genotype> {
            return Genotype.getById(user, args.id);
        },

        injection(_: any, args: { id: string }, {user}: RequestContext): Promise<Injection> {
            return Injection.getById(user, args.id);
        },

        injections(_: any, args: { input: InjectionQueryInput }, {user}: RequestContext): Promise<Injection[]> {
            return Injection.getAll(user, args.input);
        },

        neurons(_: any, args: { input: NeuronQueryInput }, {user}: RequestContext): Promise<EntityQueryOutput<Neuron>> {
            return Neuron.getAll(user, args.input);
        },

        annotations(_: any, args: { queryArgs: AnnotationsQueryArgs }, {user}: RequestContext): Promise<AnnotationQueryResponse> {
            const queryArgs = {...args.queryArgs, userId: user.id};
            // The has-one includes turn what would be three per-row fetches - atlasReconstruction, phaseFailure and
            // specimenSpaceReconstruction - into joins.  Passed here rather than added to getAll's default include, so
            // getAllPublished's own AtlasReconstruction include is not duplicated into an EagerLoadingError.
            return Annotation.getAll(user, queryArgs, [{model: AtlasReconstruction}, {model: SpecimenSpaceReconstruction}]);
        },

        async issueCount(_: any, __: any, {user}: RequestContext): Promise<number> {
            if (user.permissions & UserPermissions.Admin) {
                return Issue.getOpenCount();
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async openIssues(_: any, __: any, {user}: RequestContext): Promise<Issue[]> {
            if (user.permissions & UserPermissions.Admin) {
                return Issue.getOpen();
            }

            throw new UnauthorizedError();
        },

        apiKeys(_: any, __: any, {user}: RequestContext): Promise<ApiKey[]> {
            if (!(user.permissions & UserPermissions.Admin)) {
                throw new UnauthorizedError();
            }

            return ApiKey.findByUserId(user.id);
        },

        accessRequests(_: any, args: { input: AccessRequestQueryInput }, {user}: RequestContext): Promise<EntityQueryOutput<AccessRequest>> {
            return AccessRequest.getAll(user, args.input);
        }
    } satisfies FieldResolvers,
    Mutation: {
        updateUserPermissions(_: any, args: { id: string, permissions: number }, {user}: RequestContext): Promise<User> {
            return User.updatePermissions(args.id, args.permissions, user);
        },

        updateUserAnonymity(_: any, args: { id: string, anonymousAnnotation: boolean, anonymousPublish: boolean }, {user}: RequestContext): Promise<User> {
            return User.updateAnonymization(args.id, args.anonymousAnnotation, args.anonymousPublish, user);
        },

        createInjection(_: any, args: { injectionInput: InjectionShape }, {user}: RequestContext): Promise<Injection> {
            return Injection.createOrUpdateForShape(user, args.injectionInput, true);
        },

        updateInjection(_: any, args: { injectionInput: InjectionShape }, {user}: RequestContext): Promise<Injection> {
            return Injection.createOrUpdateForShape(user, args.injectionInput, false);
        },

        deleteInjection(_: any, args: { id: string }, {user}: RequestContext): Promise<string> {
            return Injection.deleteByPk(user, args.id);
        },

        createSpecimen(_: any, args: { specimen: SpecimenShape }, {user}: RequestContext): Promise<Specimen> {
            return Specimen.createOrUpdateForShape(args.specimen, user, {allowCreate: true});
        },

        updateSpecimen(_: any, args: { specimen: SpecimenShape }, {user}: RequestContext): Promise<Specimen> {
            return Specimen.createOrUpdateForShape(args.specimen, user);
        },

        deleteSpecimen(_: any, args: { id: string }, {user}: RequestContext): Promise<string> {
            return Specimen.deleteByPk(args.id, user);
        },

        createNeuron(_: any, args: { neuron: NeuronShape }, {user}: RequestContext): Promise<Neuron> {
            return Neuron.createOrUpdateForShape(args.neuron, user, {allowCreate: true});
        },

        updateNeuron(_: any, args: { neuron: NeuronShape }, {user}: RequestContext): Promise<Neuron> {
            return Neuron.createOrUpdateForShape(args.neuron, user);
        },

        deleteNeuron(_: any, args: { id: string }, {user}: RequestContext): Promise<string> {
            return Neuron.deleteByPk(args.id, user);
        },

        updateNeurons(_: any, args: { input: { ids: string[] } & NeuronBulkUpdateShape }, {user}: RequestContext): Promise<Neuron[]> {
            return Neuron.updateMany(args.input.ids, {keywords: args.input.keywords, atlasStructureId: args.input.atlasStructureId}, user);
        },

        updateNeuronsByQuery(_: any, args: { input: { query: NeuronQueryInput } & NeuronBulkUpdateShape }, {user}: RequestContext): Promise<Neuron[]> {
            return Neuron.updateManyByQuery(args.input.query, {keywords: args.input.keywords, atlasStructureId: args.input.atlasStructureId}, user);
        },

        createCollection(_: any, args: { collection: CollectionShape }, {user}: RequestContext): Promise<Collection> {
            return Collection.createOrUpdateForShape(user, args.collection, true);
        },

        updateCollection(_: any, args: { collection: CollectionShape }, {user}: RequestContext): Promise<Collection> {
            return Collection.createOrUpdateForShape(user, args.collection, false);
        },

        importSomas(_: any, args: { file: Promise<GqlFile>, options: CandidateImportOptions }, {user}: RequestContext): Promise<number> {
            return Specimen.receiveSomaPropertiesUpload(user, args.file, args.options);
        },

        openAnnotation(_: any, args: { neuronId: string }, {user}: RequestContext): Promise<Annotation> {
            return Neuron.startAnnotation(user, args.neuronId);
        },

        pauseAnnotation(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.pauseAnnotation(args.annotationId, user);
        },

        resumeAnnotation(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.resumeAnnotation(args.annotationId, user);
        },

        markAnnotationIncomplete(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.markIncomplete(args.annotationId, user);
        },

        markAnnotationDuplicate(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.markDuplicate(args.annotationId, user);
        },

        requestReview(_: any, args: ReviewRequestArgs, {user}: RequestContext): Promise<Annotation> {
            return Annotation.requestReview(args, user);
        },

        approveAnnotation(_: any, args: { annotationId: string, targetStatus: number }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.approveAnnotation(args.annotationId, args.targetStatus, user);
        },

        publish(_: any, args: { annotationId: string, replaceExisting: boolean }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.publish(user, args.annotationId, args.replaceExisting);
        },

        publishAll(_: any, args: { annotationIds: string[] }, {user}: RequestContext): Promise<Annotation[]> {
            return Annotation.publishAll(user, args.annotationIds);
        },

        rejectAnnotation(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.rejectAnnotation(args.annotationId, user);
        },

        discardAnnotation(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.discardAnnotation(args.annotationId, user);
        },

        markAnnotationUntraceable(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.markUntraceable(args.annotationId, user);
        },

        requestSpecimenSpaceRegeneration(_: any, args: { specimenSpaceReconstructionId: string }, {user}: RequestContext): Promise<SpecimenSpacePrecomputed> {
            return SpecimenSpacePrecomputed.requestRegenerationForReconstruction(user, args.specimenSpaceReconstructionId);
        },

        requestQualityControlReassessment(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<AtlasReconstruction> {
            return AtlasReconstruction.requestQualityControlReassessment(user, args.annotationId);
        },

        requestDoiAssignment(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<AtlasReconstruction> {
            return AtlasReconstruction.requestDoiAssignment(user, args.annotationId);
        },

        requestStructureAssignment(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<AtlasReconstruction> {
            return AtlasReconstruction.requestStructureAssignment(user, args.annotationId);
        },

        // Returns the atlas reconstruction rather than the Precomputed row: the child status is what the caller
        // needs back, and it is what distinguishes this from requestSpecimenSpaceRegeneration above.
        requestPrecomputedRegeneration(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<AtlasReconstruction> {
            return AtlasReconstruction.requestPrecomputedRegeneration(user, args.annotationId);
        },

        requestSearchIndexing(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<AtlasReconstruction> {
            return AtlasReconstruction.requestSearchIndexing(user, args.annotationId);
        },

        resetReconstructionPipeline(_: any, args: { annotationId: string }, {user}: RequestContext): Promise<AtlasReconstruction> {
            return AtlasReconstruction.resetPipeline(user, args.annotationId);
        },

        updateAnnotation(_: any, args: AnnotationMetadataArgs, {user}: RequestContext): Promise<Annotation> {
            return Annotation.updateMetadata(user, args);
        },

        openAnnotationRevision(_: any, args: { annotationId: string, revisionKind: ReconstructionRevisionKind }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.openAnnotationRevision(user, args.annotationId, args.revisionKind);
        },

        uploadSwcData(_: any, {uploadArgs}: { uploadArgs: ReconstructionUploadArgs }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.fromSwcUpload(user, uploadArgs);
        },

        uploadParquetData(_: any, {uploadArgs}: { uploadArgs: ReconstructionUploadArgs }, {user}: RequestContext): Promise<Annotation> {
            return Annotation.fromParquetUpload(user, uploadArgs);
        },

        uploadRawSwcData(_: any, {uploadArgs}: { uploadArgs: RawReconstructionUploadArgs }, {user}: RequestContext): Promise<RawReconstructionUpload> {
            return RawReconstructionUpload.fromSwcUpload(user, uploadArgs);
        },

        uploadRawParquetData(_: any, {uploadArgs}: { uploadArgs: RawReconstructionUploadArgs }, {user}: RequestContext): Promise<RawReconstructionUpload> {
            return RawReconstructionUpload.fromParquetUpload(user, uploadArgs);
        },

        createApiKey(_: any, args: { key: string, description: string, durationDays?: number, permissions?: number }, {user}: RequestContext): Promise<ApiKey> {
            if (!(user.permissions & UserPermissions.Admin)) {
                throw new UnauthorizedError();
            }

            return ApiKey.createApiKey(user, args.key, args.description, args.durationDays, args.permissions);
        },

        deleteApiKey(_: any, args: { id: string }, {user}: RequestContext): Promise<boolean> {
            if (!(user.permissions & UserPermissions.Admin)) {
                throw new UnauthorizedError();
            }

            return ApiKey.deleteApiKey(args.id, user.id);
        },

        updateAccessRequestStatus(_: any, args: { id: string, status: AccessRequestStatus }, {user}: RequestContext): Promise<AccessRequest> {
            return AccessRequest.updateStatus(user, args.id, args.status);
        },

        openIssue(_: any, args: { kind: number, description: string, references: IssueReference[] }, {user}: RequestContext): Promise<Issue> {
            return Issue.open(user, args.kind, args.description, args.references);
        },

        modifyIssue(_: any, args: { id: string, status: IssueStatus }, {user}: RequestContext): Promise<Issue> {
            return Issue.modifyStatus(user, args.id, args.status);
        },

        closeIssue(_: any, args: { id: string, resolutionKind: IssueResolutionKind, resolution: string }, {user}: RequestContext): Promise<Issue> {
            return Issue.close(user, args.id, args.resolutionKind, args.resolution);
        }
    } satisfies FieldResolvers,
    Collection: {
        specimenCount(collection: Collection): Promise<number> {
            return collection.specimenCount();
        }
    } satisfies FieldResolvers,
    Annotation: {
        neuron(annotation: Annotation): Promise<Neuron> {
            return annotation.getNeuron();
        },
        atlasReconstruction(annotation: Annotation): Promise<AtlasReconstruction> {
            // Prefer the eager-loaded child: the list queries include it, and without this the field fetches once
            // per row alongside phaseFailure doing the same.
            return Promise.resolve(annotation.AtlasReconstruction ?? annotation.getAtlasReconstruction());
        },
        specimenSpaceReconstruction(annotation: Annotation): Promise<SpecimenSpaceReconstruction> {
            // Not paranoid: a discarded or untraceable annotation is returned soft-deleted, its specimen-space row with
            // it, and the field is non-null.
            return Promise.resolve(annotation.SpecimenSpaceReconstruction ?? annotation.getSpecimenSpaceReconstruction({paranoid: false}));
        },
        rawReconstruction(annotation: Annotation): Promise<RawReconstruction> {
            return Promise.resolve(annotation.RawReconstruction ?? annotation.getRawReconstruction());
        },
        latestRawReconstructionUpload(annotation: Annotation): Promise<RawReconstructionUpload> {
            return RawReconstructionUpload.findLatestForAnnotation(annotation.id);
        },
        /**
         * Which phase is blocked and why, composed on the server so each client does not have to know which parent
         * statuses are worth pairing with which child status.  Null unless the child sits at a Failed... status.
         */
        async phaseFailure(annotation: Annotation): Promise<PhaseFailureShape | null> {
            const child = annotation.AtlasReconstruction ?? await annotation.getAtlasReconstruction();

            if (!child || !PhaseFailureStatuses.includes(child.status)) {
                return null;
            }

            return {phase: child.status, reason: child.failureReason ?? null, failedAt: child.failedAt ?? null};
        },
        annotator(annotation: Annotation): Promise<User> {
            return annotation.getAnnotator({attributes: ["id", "firstName", "lastName"]});
        },
        async reviewer(annotation: Annotation): Promise<User> {
            const user = await annotation.getReviewer({attributes: ["id", "firstName", "lastName", "isSystemUser"]});
            return user?.isSystemUser ? null : user;
        },
        async teamReviewer(annotation: Annotation): Promise<User> {
            const user = await annotation.getTeamReviewer({attributes: ["id", "firstName", "lastName", "isSystemUser"]});
            return user?.isSystemUser ? null : user;
        },
    } satisfies FieldResolvers,
    RawReconstructionUpload: {
        user(upload: RawReconstructionUpload): Promise<User> {
            return upload.getUser({attributes: ["id", "firstName", "lastName"]});
        },
        qualityControlUrl(upload: RawReconstructionUpload): string | null {
            // Only a published document can be linked: a failure before or during quality control never published one.
            return publishesQualityControlDocument(upload.status) ? rawUploadQualityControlUrl(upload.qcTag) : null;
        },
    } satisfies FieldResolvers,
    SpecimenSpaceReconstruction: {
        soma(reconstruction: SpecimenSpaceReconstruction): Promise<SpecimenNode> {
            return reconstruction.getSoma();
        },
        precomputed(reconstruction: SpecimenSpaceReconstruction): Promise<SpecimenSpacePrecomputed> {
            return reconstruction.getPrecomputed();
        },
    } satisfies FieldResolvers,
    AtlasReconstruction: {
        soma(reconstruction: AtlasReconstruction): Promise<AtlasNode> {
            return reconstruction.getSoma();
        },
        async reviewer(reconstruction: AtlasReconstruction): Promise<User> {
            const user = await reconstruction.getReviewer({attributes: ["id", "firstName", "lastName", "isSystemUser"]});
            return user?.isSystemUser ? null : user;
        },
        qualityControl(reconstruction: AtlasReconstruction): Promise<AtlasQualityControl> {
            return reconstruction.getAtlasQualityControl();
        },
        precomputed(reconstruction: AtlasReconstruction): Promise<Precomputed> {
            return reconstruction.getPrecomputed();
        }
    } satisfies FieldResolvers,
    AtlasNode: {
        nodeStructure(node: AtlasNode): Promise<NodeStructure> {
            return node.getNodeStructure();
        }
    } satisfies FieldResolvers,
    SpecimenNode: {
        nodeStructure(node: SpecimenNode): Promise<NodeStructure> {
            return node.getNodeStructure();
        }
    } satisfies FieldResolvers,
    AccessRequest: {
        admin(request: AccessRequest): Promise<User> {
            return request.adminId ? request.getAdmin({attributes: ["id", "firstName", "lastName"]}) : null;
        },
        assigned(request: AccessRequest): Promise<User> {
            return request.assignedId ? request.getAssigned({attributes: ["id", "firstName", "lastName"]}) : null;
        }
    } satisfies FieldResolvers,
    Issue: {
        neuron(issue: Issue) {
            return issue.getNeuron();
        },
        author(issue: Issue): Promise<User> {
            return issue.getAuthor();
        },
        responder(issue: Issue): Promise<User> {
            return User.findByPk(issue.responderId);
        }
    } satisfies FieldResolvers,
    VersionHistoryEvent: {
        details(event: EventLogItem): string | null {
            return event.details ? JSON.stringify(event.details) : null;
        },
        user(event: EventLogItem): Promise<User> {
            return event.getUser();
        }
    } satisfies FieldResolvers
};
