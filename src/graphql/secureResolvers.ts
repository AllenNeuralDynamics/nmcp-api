import {IIdOnlyArguments} from "./openResolvers";
import {Neuron, NeuronInput, NeuronQueryInput} from "../models/neuron";

import {BrainArea} from "../models/brainArea";
import {MouseStrain, MouseStrainInput, MouseStrainQueryInput} from "../models/mouseStrain";
import {Sample, SampleInput, SampleQueryInput} from "../models/sample";
import {DeleteOutput, EntityMutateOutput, EntityQueryOutput, SortAndLimit} from "../models/baseModel";
import {TracingStructure} from "../models/tracingStructure";
import {Tracing} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {Injection, InjectionInput, InjectionQueryInput} from "../models/injection";
import {Fluorophore, FluorophoreInput, FluorophoreQueryInput} from "../models/fluorophore";
import {InjectionVirus, InjectionVirusInput, InjectionVirusQueryInput} from "../models/injectionVirus";
import {User, UserPermissions, UserQueryInput} from "../models/user";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {GraphQLError} from "graphql/error";
import {Collection, CollectionInput} from "../models/collection";
import {Issue, IssueKind} from "../models/issue";

import GraphQLUpload = require('graphql-upload/GraphQLUpload.js');
import {loadTracingCache} from "../rawquery/tracingQueryMiddleware";
import {synchronize} from "../data-access/smartSheetClient";
import {Precomputed} from "../models/precomputed";

export class UnauthorizedError extends GraphQLError {
    public constructor() {
        super("User is not authenticated", {
            extensions: {
                code: 'FORBIDDEN',
                http: {status: 401},
            },
        })
    }
}

//
// GraphQL arguments
//

export interface IUploadFile {
    filename: string;
    encoding: string;
    mimetype: string;
    stream: any;
}

//
// General query
//

interface IUsersQueryArguments {
    input: UserQueryInput;
}

interface IMouseStrainQueryArguments {
    input: MouseStrainQueryInput;
}

interface IInjectionVirusQueryArguments {
    input: InjectionVirusQueryInput;
}

interface IFluorophoreQueryArguments {
    input: FluorophoreQueryInput;
}

interface IInjectionQueryArguments {
    input: InjectionQueryInput;
}

interface ISampleQueryArguments {
    input: SampleQueryInput;
}

interface INeuronQueryArguments {
    input: NeuronQueryInput;
}

interface ICandidateNeuronQueryArguments {
    input: NeuronQueryInput;
    includeInProgress: boolean;
}

interface ITracingUploadArguments {
    reconstructionId: string;
    structureId: string;
    file: Promise<IUploadFile>;
}

interface IMarkReconstructionCompleteArguments {
    id: string;
    duration: number;
    length: number;
    notes: string;
    checks: string;
}

export interface IReconstructionPageInput {
    offset: number;
    limit: number;
    userOnly: boolean;
    filters: ReconstructionStatus[];
    sampleIds?: string[];
}

interface IReconstructionArguments {
    pageInput: IReconstructionPageInput;
}

export interface IReconstructionPage {
    offset: number;
    limit: number;
    totalCount: number;
    reconstructions: Reconstruction[];
}

export interface ReviewPageInput {
    offset: number;
    limit: number;
    sampleIds: string[];
    status: ReconstructionStatus[];
}

export interface ReviewPageArguments {
    input: ReviewPageInput;
}

export interface IUploadOutput {
    tracings: Tracing[];
    error: Error;
}

//
// General mutate
//
interface IUserMutateArguments {
    id: string;
    permissions: number;
    anonymousCandidate: boolean;
    anonymousComplete: boolean;
}

interface IMouseStrainMutateArguments {
    mouseStrain: MouseStrainInput;
}

interface IInjectionVirusMutateArguments {
    injectionVirus: InjectionVirusInput;
}

interface IFluorophoreMutateArguments {
    fluorophore: FluorophoreInput;
}

interface IInjectionMutateArguments {
    injectionInput: InjectionInput;
}

interface ISampleMutateArguments {
    sample: SampleInput;
}

interface INeuronMutateArguments {
    neuron: NeuronInput;
}

interface ICollectionMutateArguments {
    collection: CollectionInput
}

type CreateIssueArguments = {
    description: string;
    neuronId: string;
    reconstructionId: string;
}

//
// Output
//
export interface IErrorOutput {
    message: string;
    name: string;
}

/**
 * All resolvers/functionality that requires any form of authorization except for internal-only.  Any query or mutation must enforce some level authorization
 * above UserPermissions.None. Functionality that is allowed to be used without authentication or authorization (e.g., basic viewer use) should be in
 * openResolvers.ts.  Functionality that should only be authorized to other internal services and not to a remote client should be in internalResolvers.ts.
 */
export const secureResolvers = {
    Upload: GraphQLUpload,

    Query: {
        users(_: any, args: IUsersQueryArguments, context: User): Promise<EntityQueryOutput<User>> {
            if (context.permissions & UserPermissions.Admin) {
                return User.getAll(args.input);
            }

            throw new UnauthorizedError();
        },

        mouseStrains(_: any, args: IMouseStrainQueryArguments, context: User): Promise<MouseStrain[]> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        mouseStrain(_: any, args: IIdOnlyArguments, context: User): Promise<MouseStrain> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        injectionViruses(_: any, args: IInjectionVirusQueryArguments, context: User): Promise<InjectionVirus[]> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        injectionVirus(_: any, args: IIdOnlyArguments, context: User): Promise<InjectionVirus> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        fluorophores(_: any, args: IFluorophoreQueryArguments, context: User): Promise<Fluorophore[]> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        fluorophore(_: any, args: IIdOnlyArguments, context: User): Promise<Fluorophore> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        injections(_: any, args: IInjectionQueryArguments, context: User): Promise<Injection[]> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        injection(_: any, args: IIdOnlyArguments, context: User): Promise<Injection> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        samples(_: any, args: ISampleQueryArguments, context: User): Promise<EntityQueryOutput<Sample>> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        sample(_: any, args: IIdOnlyArguments, context: User): Promise<Sample> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        neurons(_: any, args: INeuronQueryArguments, context: User): Promise<EntityQueryOutput<Neuron>> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        neuron(_: any, args: IIdOnlyArguments, context: User): Promise<Neuron> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        candidateNeurons(_: any, args: ICandidateNeuronQueryArguments, context: User): Promise<EntityQueryOutput<Neuron>> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                return Neuron.getCandidateNeurons(args.input, args.includeInProgress);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        reconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<Reconstruction> {
            if (context.permissions & UserPermissions.Edit) {
                return Reconstruction.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        reconstructions(_: any, args: IReconstructionArguments, context: User): Promise<IReconstructionPage> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                if (args.pageInput.userOnly) {
                    return Reconstruction.getAll(args.pageInput, context.id);
                } else {
                    return Reconstruction.getAll(args.pageInput);
                }
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async reviewableReconstructions(_: any, args: ReviewPageArguments, context: User): Promise<IReconstructionPage> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.getReviewableAnnotations(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async candidatesForReview(_: any, __: any, context: User): Promise<Neuron[]> {
            if (context.permissions & UserPermissions.Review) {
                return Neuron.getCandidateNeuronsForReview();
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

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        }
    },
    Mutation: {
        async updateUserPermissions(_: any, args: IUserMutateArguments, context: User): Promise<User> {
            if (context.permissions & UserPermissions.Admin) {
                return User.updatePermissions(args.id, args.permissions);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async updateUserAnonymity(_: any, args: IUserMutateArguments, context: User): Promise<User> {
            if (context.permissions & UserPermissions.Admin) {
                return User.updateAnonymity(args.id, args.anonymousCandidate, args.anonymousCandidate);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createMouseStrain(_: any, args: IMouseStrainMutateArguments, context: User): Promise<EntityMutateOutput<MouseStrain>> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.createWith(args.mouseStrain);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateMouseStrain(_: any, args: IMouseStrainMutateArguments, context: User): Promise<EntityMutateOutput<MouseStrain>> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.updateWith(args.mouseStrain);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createInjectionVirus(_: any, args: IInjectionVirusMutateArguments, context: User): Promise<EntityMutateOutput<InjectionVirus>> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.createWith(args.injectionVirus);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateInjectionVirus(_: any, args: IInjectionVirusMutateArguments, context: User): Promise<EntityMutateOutput<InjectionVirus>> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.updateWith(args.injectionVirus);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createFluorophore(_: any, args: IFluorophoreMutateArguments, context: User): Promise<EntityMutateOutput<Fluorophore>> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.createWith(args.fluorophore);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateFluorophore(_: any, args: IFluorophoreMutateArguments, context: User): Promise<EntityMutateOutput<Fluorophore>> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.updateWith(args.fluorophore);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createInjection(_: any, args: IInjectionMutateArguments, context: User): Promise<EntityMutateOutput<Injection>> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.createWith(args.injectionInput);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateInjection(_: any, args: IInjectionMutateArguments, context: User): Promise<EntityMutateOutput<Injection>> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.updateWith(args.injectionInput);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        deleteInjection(_: any, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.deleteFor(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createSample(_: any, args: ISampleMutateArguments, context: User): Promise<EntityMutateOutput<Sample>> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.createWith(args.sample);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateSample(_: any, args: ISampleMutateArguments, context: User): Promise<EntityMutateOutput<Sample>> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.updateWith(args.sample);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        deleteSample(_: any, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.deleteFor(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createNeuron(_: any, args: INeuronMutateArguments, context: User): Promise<EntityMutateOutput<Neuron>> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.createWith(args.neuron);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateNeuron(_: any, args: INeuronMutateArguments, context: User): Promise<EntityMutateOutput<Neuron>> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.updateWith(args.neuron);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        deleteNeuron(_: any, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.deleteFor(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        createCollection(_: any, args: ICollectionMutateArguments, context: User): Promise<EntityMutateOutput<Collection>> {
            if (context.permissions & UserPermissions.Admin) {
                return Collection.createWith(args.collection);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        updateCollection(_: any, args: ICollectionMutateArguments, context: User): Promise<EntityMutateOutput<Collection>> {
            if (context.permissions & UserPermissions.Admin) {
                return Collection.updateWith(args.collection);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        deleteCollection(_: any, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Admin) {
                return Collection.deleteFor(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        uploadSwc(_: any, args: ITracingUploadArguments, context: User): Promise<IUploadOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Tracing.createTracingFromUpload(args.reconstructionId, args.structureId, args.file);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        requestReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<Neuron> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                return Neuron.requestAnnotation(args.id, context);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async requestReconstructionHold(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.markAnnotationOnHold(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async cancelReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.cancelAnnotation(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async updateReconstruction(_: any, args: IMarkReconstructionCompleteArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review || await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async requestReconstructionReview(_: any, args: IMarkReconstructionCompleteArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks, true);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        approveReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.approveAnnotation(args.id, context.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        declineReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.declineAnnotation(args.id, context.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        completeReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.completeAnnotation(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        unpublish(_: any, args: IIdOnlyArguments, context: User): Promise<boolean> {
            if (context.permissions & UserPermissions.Admin) {
                return Reconstruction.unpublish(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async importSmartSheet(_: any, args: IIdOnlyArguments, context: User): Promise<boolean>{
            if (context.permissions & UserPermissions.Admin) {
               await synchronize(3824679856852868, "", 0, args.id);
               return true;
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async reload(_: any, args: IIdOnlyArguments, context: User): Promise<boolean> {
            if (context.permissions & UserPermissions.Admin) {
                await loadTracingCache(false);
                await Reconstruction.loadReconstructionCache();
                return true;
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async createIssue(_: any, args: CreateIssueArguments, context: User): Promise<Issue> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                return Issue.createWith(IssueKind.Uncategorized, args.description, args.neuronId);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        }
    },
    BrainArea: {
        neurons(brainArea: BrainArea): Promise<Neuron[]> {
            return brainArea.getNeurons();
        },
    },
    MouseStrain: {
        samples(mouseStrain: MouseStrain): Promise<Sample[]> {
            return mouseStrain.getSamples();
        },
    },
    InjectionVirus: {
        injections(injectionVirus: InjectionVirus): Promise<Injection[]> {
            return injectionVirus.getInjections();
        },
    },
    Fluorophore: {
        injections(fluorophore: Fluorophore): Promise<Injection[]> {
            return fluorophore.getInjections();
        },
    },
    Injection: {
        injectionVirus(injection: Injection): Promise<InjectionVirus> {
            return injection.getInjectionVirus();
        },
        fluorophore(injection: Injection): Promise<Fluorophore> {
            return injection.getFluorophore();
        },
        brainArea(injection: Injection): Promise<BrainArea> {
            return injection.getBrainArea();
        },
        sample(injection: Injection): Promise<Sample> {
            return injection.getSample();
        },
    },
    Sample: {
        mouseStrain(sample: Sample, _: any, __: any): Promise<MouseStrain> {
            return sample.getMouseStrain();
        },
        injections(sample: Sample): Promise<Injection[]> {
            return sample.getInjections();
        },
        neurons(sample: Sample): Promise<Neuron[]> {
            return sample.getNeurons();
        },
        async neuronCount(sample: Sample): Promise<number> {
            const output = await Sample.neuronCountsPerSample([sample.id]);

            if (output.counts.length === 1) {
                return output.counts[0].count;
            }

            return 0;
        }
    },
    Neuron: {
        brainArea(neuron: Neuron): Promise<BrainArea> {
            return neuron.getBrainArea();
        },
        sample(neuron: Neuron): Promise<Sample> {
            return neuron.getSample();
        },
        reconstructions(neuron: Neuron): Promise<Reconstruction[]> {
            return neuron.getReconstructions();
        },
        async tracings(neuron: Neuron): Promise<Tracing[]> {
            const reconstructions = await neuron.getReconstructions();

            if (reconstructions.length == 0) {
                return [];
            }

            // TODO first complete reconstruction not simply the first one.
            return [await reconstructions[0].getAxon(), await reconstructions[0].getDendrite()];
        }
    },
    Tracing: {
        async tracingStructure(tracing, _: any, context: User): Promise<TracingStructure> {
            const result: Tracing = await Tracing.findByPk(tracing.id);
            return result ? result.getTracingStructure() : null;
        },
        reconstruction(tracing, _: any, context: User): Promise<Reconstruction> {
            return Reconstruction.findByPk(tracing.reconstructionId);
        },
        soma(tracing, _: any, context: User): Promise<TracingNode> {
            return TracingNode.findByPk(tracing.somaNodeId);
        }
    },
    TracingNode: {
        brainStructure(node, _: any, context: User): Promise<BrainArea> {
            return BrainArea.findByPk(node.brainStructureId);
        }
    },
    User: {
        reconstructions(user: User): Promise<Reconstruction[]> {
            return user.getReconstructions();
        }
    },
    Reconstruction: {
        annotator(reconstruction: Reconstruction): Promise<User> {
            return reconstruction.getAnnotator();
        },
        proofreader(reconstruction: Reconstruction): Promise<User> {
            return reconstruction.getProofreader();
        },
        neuron(reconstruction: Reconstruction): Promise<Neuron> {
            return reconstruction.getNeuron();
        },
        axon(reconstruction: Reconstruction): Promise<Tracing> {
            return reconstruction.getAxon();
        },
        dendrite(reconstruction: Reconstruction): Promise<Tracing> {
            return reconstruction.getDendrite();
        },
        precomputed(reconstruction: Reconstruction): Promise<Precomputed> {
            return reconstruction.getPrecomputed();
        }
    }
};
