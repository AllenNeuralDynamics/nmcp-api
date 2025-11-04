import {IIdOnlyArguments} from "./openResolvers";
import {Neuron, NeuronInput, NeuronQueryInput} from "../models/neuron";

import {AtlasStructure} from "../models/atlasStructure";
import {MouseStrain, MouseStrainInput, MouseStrainQueryInput} from "../models/mouseStrain";
import {Sample, SampleInput, SampleQueryInput} from "../models/sample";
import {DeleteOutput, EntityMutateOutput, EntityQueryOutput} from "../models/baseModel";
import {TracingStructure} from "../models/tracingStructure";
import {Tracing} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {Injection, InjectionInput, InjectionQueryInput} from "../models/injection";
import {Fluorophore, FluorophoreInput, FluorophoreQueryInput} from "../models/fluorophore";
import {InjectionVirus, InjectionVirusInput, InjectionVirusQueryInput} from "../models/injectionVirus";
import {User, UserPermissions, UserQueryInput} from "../models/user";
import {QualityCheckOutput, Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {GraphQLError} from "graphql/error";
import {Collection, CollectionInput} from "../models/collection";
import {Issue, IssueKind} from "../models/issue";
import {Precomputed} from "../models/precomputed";
import GraphQLUpload = require("graphql-upload/GraphQLUpload.js");
import {UnregisteredReconstruction} from "../models/unregisteredReconstruction";
import {QualityCheckStatus} from "../models/qualityCheckStatus";

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

interface ITracingUploadArguments {
    reconstructionId: string;
    structureId: string;
    file: Promise<IUploadFile>;
}

type UnregisteredJsonUploadArguments = {
    neuronId: string;
    file: Promise<IUploadFile>;
    reconstructionId?: string;   // For overwrite
}

type UnregisteredSwcUploadArguments = {
    neuronId: string;
    axonFile: Promise<IUploadFile>;
    dendriteFile: Promise<IUploadFile>;
    reconstructionId?: string;   // For overwrite
}

export type SomaImportOptions = {
    sampleId: string;
    tag: string;
    shouldLookupSoma: boolean;
    noEmit: boolean;
}

interface IImportSomasArguments {
    file: Promise<IUploadFile>;
    options: SomaImportOptions
}

interface IRequestReconstructionReviewArguments {
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
}

export interface FullReviewPageInput extends ReviewPageInput {
    status: ReconstructionStatus[];
    qualityCheckStatus: QualityCheckStatus[];
}

export interface PeerReviewPageInput extends ReviewPageInput {
    tag: string;
}

export interface ReviewPageArguments {
    input: FullReviewPageInput;
}

export interface PeerReviewPageArguments {
    input: PeerReviewPageInput;
}

export type ReconstructionUploadOutput = {
    tracings: Tracing[];
    error: Error;
}

export type UnregisteredReconstructionUploadOutput = {
    reconstruction: UnregisteredReconstruction;
    error: Error;
}

export type ImportSomasOutput = {
    count: number;
    idStrings: string[];
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
    neuronId: string;
    reconstructionId?: string;
    kind: IssueKind;
    description: string;
}

type CloseIssueArguments = {
    id: string;
    reason: string;
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

        genotypes(_: any, args: IMouseStrainQueryArguments, context: User): Promise<MouseStrain[]> {
            if (context.permissions & UserPermissions.ViewAll) {
                return MouseStrain.getAll(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        genotype(_: any, args: IIdOnlyArguments, context: User): Promise<MouseStrain> {
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
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
            if (context.permissions & UserPermissions.ViewAll) {
                return Neuron.findByPk(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async unregisteredReconstructions(_: any, args: { neuronId: string }, context: User): Promise<UnregisteredReconstruction[]> {
            if (context.permissions & UserPermissions.Edit) {
                const neuron = await Neuron.findByPk(args.neuronId);

                if (neuron) {
                    return await neuron.getUnregisteredReconstructions();
                }

                return [];
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
            if (context.permissions & UserPermissions.FullReview) {
                return Reconstruction.getReviewableReconstructions(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async peerReviewableReconstructions(_: any, args: PeerReviewPageArguments, context: User): Promise<IReconstructionPage> {
            if (context.permissions & UserPermissions.PeerReview) {
                return Reconstruction.getPeerReviewableReconstructions(args.input);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async issueCount(_: any, __: any, context: User): Promise<number> {
            if (context.permissions & UserPermissions.Admin) {
                return Issue.getCount();
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

        uploadReconstructionData(_: any, args: ITracingUploadArguments, context: User): Promise<ReconstructionUploadOutput> {
            if (context.permissions & UserPermissions.FullReview) {
                return Tracing.createTracingFromUpload(args.reconstructionId, args.structureId, args.file);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        uploadUnregisteredJsonData(_: any, args: UnregisteredJsonUploadArguments, context: User): Promise<UnregisteredReconstructionUploadOutput> {
            if (context.permissions & UserPermissions.PeerReview) {
                return UnregisteredReconstruction.fromJsonUpload(args.neuronId, args.file, args.reconstructionId);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        uploadUnregisteredSwcData(_: any, args: UnregisteredSwcUploadArguments, context: User): Promise<UnregisteredReconstructionUploadOutput> {
            if (context.permissions & UserPermissions.PeerReview) {
                return UnregisteredReconstruction.fromSwcUpload(args.neuronId, args.axonFile, args.dendriteFile, args.reconstructionId);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        importSomas(_: any, args: IImportSomasArguments, context: User): Promise<ImportSomasOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.receiveSomaPropertiesUpload(args.file, args.options);
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

        async updateReconstruction(_: any, args: IRequestReconstructionReviewArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.FullReview || await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async requestReconstructionPeerReview(_: any, args: IRequestReconstructionReviewArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks, ReconstructionStatus.InPeerReview);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async requestReconstructionReview(_: any, args: IRequestReconstructionReviewArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.PeerReview || await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks, ReconstructionStatus.InReview);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        approveReconstructionPeerReview(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.PeerReview) {
                return Reconstruction.approveReconstructionPeerReview(args.id, context.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        approveReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.FullReview) {
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
            if (context.permissions & UserPermissions.FullReview) {
                return Reconstruction.declineAnnotation(args.id, context.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        publishReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.FullReview) {
                return Reconstruction.publishAnnotation(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async deleteReconstruction(_: any, args: IIdOnlyArguments, context: User): Promise<boolean> {
            if (context.permissions & UserPermissions.Admin) {
                return await Reconstruction.deleteEntry(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async requestQualityCheck(_: any, args: IIdOnlyArguments, context: User): Promise<QualityCheckOutput> {
            if (context.permissions & UserPermissions.FullReview) {
                return await Reconstruction.requestQualityCheck(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async unpublish(_: any, args: IIdOnlyArguments, context: User): Promise<boolean> {
            if (context.permissions & UserPermissions.Admin) {
                // id can be a reconstruction id or a neuron id.
                const wasValidReconstruction = await Reconstruction.unpublish(args.id);

                if (!wasValidReconstruction) {
                    return await Neuron.unpublish(args.id);
                }

                return wasValidReconstruction;
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async createIssue(_: any, args: CreateIssueArguments, context: User): Promise<Issue> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                return Issue.createWith(context.id, args.kind, args.description, args.neuronId);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },

        async closeIssue(_: any, args: CloseIssueArguments, context: User): Promise<boolean> {
            if (context.permissions & UserPermissions.Admin) {
                return Issue.close(context.id, args.id, args.reason);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        }
    },
    AtlasStructure: {
        neurons(atlasStructure: AtlasStructure): Promise<Neuron[]> {
            return atlasStructure.getNeurons();
        },
    },
    Genotype: {
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
        brainArea(injection: Injection): Promise<AtlasStructure> {
            return injection.getBrainArea();
        },
        sample(injection: Injection): Promise<Sample> {
            return injection.getSample();
        },
    },
    Sample: {
        genotype(sample: Sample, _: any, __: any): Promise<MouseStrain> {
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
        atlasStructure(neuron: Neuron): Promise<AtlasStructure> {
            return neuron.getAtlasStructure();
        },
        sample(neuron: Neuron): Promise<Sample> {
            return neuron.getSample();
        },
        latest(neuron: Neuron): Promise<Reconstruction> {
            return neuron.latest();
        },
        reconstructionCount(neuron: any): Promise<number> {
            return Reconstruction.count({where: {neuronId: neuron.id}})
        },
        reconstructions(neuron: Neuron): Promise<Reconstruction[]> {
            return neuron.getReconstructions();
        },
        unregisteredReconstructionCount(neuron: any): Promise<number> {
            return UnregisteredReconstruction.count({where: {neuronId: neuron.id}})
        },
        unregisteredReconstructions(neuron: Neuron): Promise<UnregisteredReconstruction[]> {
            return neuron.getUnregisteredReconstructions();
        }
    },
    Tracing: {
        async tracingStructure(tracing: Tracing, _: any, context: User): Promise<TracingStructure> {
            const result: Tracing = await Tracing.findByPk(tracing.id);
            return result ? result.getTracingStructure() : null;
        },
        reconstruction(tracing: Tracing, _: any, context: User): Promise<Reconstruction> {
            return Reconstruction.findByPk(tracing.reconstructionId);
        },
        soma(tracing: Tracing, _: any, context: User): Promise<TracingNode> {
            return TracingNode.findByPk(tracing.somaNodeId);
        },
        nodes(tracing: Tracing, _: any, context: User): Promise<TracingNode[]> {
            return tracing.getNodes();
        }
    },
    TracingNode: {
        brainStructure(node: TracingNode, _: any, context: User): Promise<AtlasStructure> {
            return AtlasStructure.findByPk(node.brainStructureId);
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
        peerReviewer(reconstruction: Reconstruction): Promise<User> {
            return reconstruction.getPeerReviewer();
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
    },
    Issue: {
        creator(issue: Issue): Promise<User> {
            return issue.getCreator();
        },
        neuron(issue: Issue): Promise<Neuron> {
            return issue.getNeuron();
        },
        responder(issue: Issue): Promise<User> {
            try {
                return User.findByPk(issue.responderId);
            } catch (error) {
            }
            return null;
        }
    }
};
