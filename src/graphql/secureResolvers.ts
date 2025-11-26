import {IdArgs} from "./openResolvers";
import {Neuron, NeuronShape, NeuronQueryInput} from "../models/neuron";

import {Genotype} from "../models/genotype";
import {CandidateImportOptions, Specimen, SpecimenShape} from "../models/specimen";
import {EntityQueryOutput} from "../models/baseModel";
import {Injection, InjectionShape, InjectionQueryInput} from "../models/injection";
import {User, UserPermissions, UserQueryInput} from "../models/user";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {GraphQLError} from "graphql/error";
import {Collection, CollectionShape} from "../models/collection";
import {Issue, IssueReference, IssueResolutionKind, IssueStatus} from "../models/issue";
import {
    JsonUploadArgs,
    ReconstructionQueryResponse,
    ReconstructionsQueryArgs,
    ReviewRequestArgs,
    Reconstruction,
    SwcUploadArgs, ReconstructionMetadataArgs
} from "../models/reconstruction";
import GraphQLUpload = require("graphql-upload/GraphQLUpload.js");
import {QualityControl} from "../models/qualityControl";
import {AtlasNode} from "../models/atlasNode";
import {Precomputed} from "../models/precomputed";
import {NodeStructure} from "../models/nodeStructure";

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

// noinspection JSUnusedGlobalSymbols
/**
 * All resolvers/functionality that requires any form of authorization except for internal-only.  Any query or mutation must enforce some level authorization
 * above UserPermissions.None. Functionality that is allowed to be used without authentication or authorization (e.g., basic viewer use) should be in
 * openResolvers.ts.  Functionality that should only be authorized to other internal services and not to a remote client should be in internalResolvers.ts.
 */
export const secureResolvers = {
    Upload: GraphQLUpload,

    Query: {
        users(_: any, args: { input: UserQueryInput }, context: User): Promise<EntityQueryOutput<User>> {
            if (context.permissions & UserPermissions.Admin) {
                return User.getAll(args.input);
            }

            throw new UnauthorizedError();
        },

        genotype(_: any, args: IdArgs, context: User): Promise<Genotype> {
            if (context.permissions & UserPermissions.ViewAll) {
                return Genotype.findByPk(args.id);
            }

            throw new UnauthorizedError();
        },

        injection(_: any, args: IdArgs, context: User): Promise<Injection> {
            if (context.permissions & UserPermissions.ViewAll) {
                return Injection.findByPk(args.id);
            }

            throw new UnauthorizedError();
        },

        injections(_: any, args: { input: InjectionQueryInput }, context: User): Promise<Injection[]> {
            if (context.permissions & UserPermissions.ViewAll) {
                return Injection.getAll(args.input);
            }

            throw new UnauthorizedError();
        },

        specimen(_: any, args: IdArgs, context: User): Promise<Specimen> {
            if (context.permissions & UserPermissions.ViewAll) {
                return Specimen.findByPk(args.id);
            }

            throw new UnauthorizedError();
        },

        neurons(_: any, args: { input: NeuronQueryInput }, context: User): Promise<EntityQueryOutput<Neuron>> {
            if (context.permissions & UserPermissions.ViewAll) {
                return Neuron.getAll(args.input);
            }

            throw new UnauthorizedError();
        },

        reconstructions(_: any, args: { queryArgs: ReconstructionsQueryArgs }, user: User): Promise<ReconstructionQueryResponse> {
            const queryArgs = {...args.queryArgs, userId: user.id};
            return Reconstruction.getAll(user, queryArgs);
        },

        async issueCount(_: any, __: any, context: User): Promise<number> {
            if (context.permissions & UserPermissions.Admin) {
                return Issue.getOpenCount();
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async openIssues(_: any, __: any, context: User): Promise<Issue[]> {
            if (context.permissions & UserPermissions.Admin) {
                return Issue.getOpen();
            }

            throw new UnauthorizedError();
        }
    },
    Mutation: {
        updateUserPermissions(_: any, args: { id: string, permissions: number }, user: User): Promise<User> {
            return User.updatePermissions(args.id, args.permissions, user);
        },

        updateUserAnonymity(_: any, args: { id: string, anonymousAnnotation: boolean, anonymousPublish: boolean }, user: User): Promise<User> {
            return User.updateAnonymization(args.id, args.anonymousAnnotation, args.anonymousPublish, user);
        },

        createInjection(_: any, args: { injectionInput: InjectionShape }, user: User): Promise<Injection> {
            return Injection.createOrUpdateForShape(user, args.injectionInput, true);
        },

        updateInjection(_: any, args: { injectionInput: InjectionShape }, user: User): Promise<Injection> {
            return Injection.createOrUpdateForShape(user, args.injectionInput, false);
        },

        deleteInjection(_: any, args: IdArgs, user: User): Promise<string> {
            return Injection.deleteByPk(user, args.id);
        },

        createSpecimen(_: any, args: { specimen: SpecimenShape }, user: User): Promise<Specimen> {
            return Specimen.createOrUpdateForShape(args.specimen, user, {allowCreate: true});
        },

        updateSpecimen(_: any, args: { specimen: SpecimenShape }, user: User): Promise<Specimen> {
            return Specimen.createOrUpdateForShape(args.specimen, user);
        },

        deleteSpecimen(_: any, args: { id: string }, user: User): Promise<string> {
            return Specimen.deleteByPk(args.id, user);
        },

        createNeuron(_: any, args: { neuron: NeuronShape }, user: User): Promise<Neuron> {
            return Neuron.createOrUpdateForShape(args.neuron, user, {allowCreate: true});
        },

        updateNeuron(_: any, args: { neuron: NeuronShape }, user: User): Promise<Neuron> {
            return Neuron.createOrUpdateForShape(args.neuron, user);
        },

        deleteNeuron(_: any, args: IdArgs, user: User): Promise<string> {
            return Neuron.deleteByPk(args.id, user);
        },

        createCollection(_: any, args: { collection: CollectionShape }, user: User): Promise<Collection> {
            return Collection.createOrUpdateForShape(user, args.collection, true);
        },

        updateCollection(_: any, args: { collection: CollectionShape }, user: User): Promise<Collection> {
            return Collection.createOrUpdateForShape(user, args.collection, false);
        },

        importSomas(_: any, args: { file: Promise<GqlFile>, options: CandidateImportOptions }, user: User): Promise<number> {
            return Specimen.receiveSomaPropertiesUpload(user, args.file, args.options);
        },

        openReconstruction(_: any, args: { neuronId: string }, user: User): Promise<Reconstruction> {
            return Neuron.startReconstruction(user, args.neuronId);
        },

        pauseReconstruction(_: any, args: { reconstructionId: string }, user: User): Promise<Reconstruction> {
            return Reconstruction.pauseReconstruction(args.reconstructionId, user);
        },

        resumeReconstruction(_: any, args: { reconstructionId: string }, user: User): Promise<Reconstruction> {
            return Reconstruction.resumeReconstruction(args.reconstructionId, user);
        },

        requestReview(_: any, args: ReviewRequestArgs, user: User): Promise<Reconstruction> {
            return Reconstruction.requestReview(args, user);
        },

        approveReconstruction(_: any, args: { reconstructionId: string, targetStatus: number }, user: User): Promise<Reconstruction> {
            return Reconstruction.approveReconstruction(args.reconstructionId, args.targetStatus, user);
        },

        publish(_: any, args: { reconstructionId: string }, user: User): Promise<Reconstruction> {
            return Reconstruction.publish(user, args.reconstructionId);
        },

        publishAll(_: any, args: { reconstructionIds: string[] }, user: User): Promise<Reconstruction[]> {
            return Reconstruction.publishAll(user, args.reconstructionIds);
        },

        rejectReconstruction(_: any, args: { reconstructionId: string }, user: User): Promise<Reconstruction> {
            return Reconstruction.rejectReconstruction(args.reconstructionId, user);
        },

        discardReconstruction(_: any, args: { reconstructionId: string }, user: User): Promise<Reconstruction> {
            return Reconstruction.discardReconstruction(args.reconstructionId, user);
        },

        updateReconstruction(_: any, args: ReconstructionMetadataArgs, user: User): Promise<Reconstruction> {
            return Reconstruction.updateMetadata(user, args);
        },

        uploadJsonData(_: any, {uploadArgs}: { uploadArgs: JsonUploadArgs }, user: User): Promise<Reconstruction> {
            return Reconstruction.fromJsonUpload(user, uploadArgs);
        },

        uploadSwcData(_: any, {uploadArgs}: { uploadArgs: SwcUploadArgs }, user: User): Promise<Reconstruction> {
            return Reconstruction.fromSwcUpload(user, uploadArgs);
        },

        openIssue(_: any, args: { kind: number, description: string, references: IssueReference[] }, user: User): Promise<Issue> {
            return Issue.open(user, args.kind, args.description, args.references);
        },

        modifyIssue(_: any, args: { id: string, status: IssueStatus }, user: User): Promise<Issue> {
            return Issue.modifyStatus(user, args.id, args.status);
        },

        closeIssue(_: any, args: { id: string, resolutionKind: IssueResolutionKind, resolution: string }, user: User): Promise<Issue> {
            return Issue.close(user, args.id, args.resolutionKind, args.resolution);
        }
    },
    Collection: {
        specimenCount(collection: Collection): Promise<number> {
            return collection.specimenCount();
        }
    },
    Reconstruction: {
        neuron(reconstruction: Reconstruction): Promise<Neuron> {
            return reconstruction.getNeuron();
        },
        atlasReconstruction(reconstruction: Reconstruction): Promise<AtlasReconstruction> {
            return reconstruction.getAtlasReconstruction();
        },
        annotator(reconstruction: Reconstruction): Promise<User> {
            return reconstruction.getAnnotator({attributes: ["id", "firstName", "lastName"]});
        },
        async reviewer(reconstruction: Reconstruction): Promise<User> {
            const user = await reconstruction.getReviewer({attributes: ["id", "firstName", "lastName"]});
            return user?.isSystemUser ? null : user;
        },
    },
    AtlasReconstruction: {
        soma(reconstruction: AtlasReconstruction): Promise<AtlasNode> {
            return reconstruction.getSoma();
        },
        async reviewer(reconstruction: AtlasReconstruction): Promise<User> {
            const user = await reconstruction.getReviewer({attributes: ["id", "firstName", "lastName", "isSystemUser"]});
            return user?.isSystemUser ? null : user;
        },
        qualityControl(reconstruction: AtlasReconstruction): Promise<QualityControl> {
            return reconstruction.getQualityControl();
        },
        precomputed(reconstruction: AtlasReconstruction): Promise<Precomputed> {
            return reconstruction.getPrecomputed();
        }
    },
    AtlasNode: {
        nodeStructure(node: AtlasNode): Promise<NodeStructure> {
            return node.getNodeStructure();
        }
    },
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
    }
};
