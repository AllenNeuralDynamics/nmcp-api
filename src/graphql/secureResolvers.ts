import {IIdOnlyArguments} from "./openResolvers";

const GraphQLUpload = require('graphql-upload/GraphQLUpload.js');

import {Neuron, NeuronInput, NeuronQueryInput} from "../models/neuron";

import {BrainArea} from "../models/brainArea";
import {MouseStrain, MouseStrainInput, MouseStrainQueryInput} from "../models/mouseStrain";
import {SampleInput, Sample, SampleQueryInput} from "../models/sample";
import {DeleteOutput, EntityMutateOutput, EntityQueryOutput, SortAndLimit} from "../models/baseModel";
import {TracingStructure} from "../models/tracingStructure";
import {Tracing} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {Injection, InjectionInput, InjectionQueryInput} from "../models/injection";
import {Fluorophore, FluorophoreInput, FluorophoreQueryInput} from "../models/fluorophore";
import {InjectionVirus, InjectionVirusInput, InjectionVirusQueryInput} from "../models/injectionVirus";
import {User, UserPermissions} from "../models/user";
import {Reconstruction} from "../models/reconstruction";
import {ReconstructionStatus} from "../models/reconstructionStatus";
import {GraphQLError} from "graphql/error";

export class UnauthorizedError extends GraphQLError {
    public constructor() {
        super('User is not authenticated', {
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
    input: SortAndLimit;
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
    neuronId: string;
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
        users(_, args: IUsersQueryArguments, context: User): Promise<EntityQueryOutput<User>> {
            if (context.permissions & UserPermissions.Admin) {
                return User.getAll(args.input);
            }

            throw new UnauthorizedError();
        },

        mouseStrains(_, args: IMouseStrainQueryArguments, context: User): Promise<MouseStrain[]> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.getAll(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        mouseStrain(_, args: IIdOnlyArguments, context: User): Promise<MouseStrain> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.findByPk(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        injectionViruses(_, args: IInjectionVirusQueryArguments, context: User): Promise<InjectionVirus[]> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.getAll(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        injectionVirus(_, args: IIdOnlyArguments, context: User): Promise<InjectionVirus> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.findByPk(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        fluorophores(_, args: IFluorophoreQueryArguments, context: User): Promise<Fluorophore[]> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.getAll(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        fluorophore(_, args: IIdOnlyArguments, context: User): Promise<Fluorophore> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.findByPk(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        injections(_, args: IInjectionQueryArguments, context: User): Promise<Injection[]> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.getAll(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        injection(_, args: IIdOnlyArguments, context: User): Promise<Injection> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.findByPk(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        samples(_, args: ISampleQueryArguments, context: User): Promise<EntityQueryOutput<Sample>> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.getAll(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        sample(_, args: IIdOnlyArguments, context: User): Promise<Sample> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.findByPk(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        neurons(_, args: INeuronQueryArguments, context: User): Promise<EntityQueryOutput<Neuron>> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.getAll(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        neuron(_, args: IIdOnlyArguments, context: User): Promise<Neuron> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.findByPk(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        candidateNeurons(_, args: INeuronQueryArguments, context: User): Promise<EntityQueryOutput<Neuron>> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                return Neuron.getCandidateNeurons(args.input);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        reconstructions(_, args: IReconstructionArguments, context: User): Promise<IReconstructionPage> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                if (args.pageInput.userOnly) {
                    return Reconstruction.getAll(args.pageInput, context.id);
                } else {
                    return Reconstruction.getAll(args.pageInput);
                }
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async reviewableReconstructions(_, __, context: User): Promise<Reconstruction[]> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.getReviewableAnnotations();
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async candidatesForReview(_, __, context: User): Promise<Neuron[]> {
            if (context.permissions & UserPermissions.Review) {
                return Neuron.getCandidateNeuronsForReview();
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        }
    },
    Mutation: {
        async updateUserPermissions(_, args: IUserMutateArguments, context: User): Promise<User> {
            if (context.permissions & UserPermissions.Admin) {
                return User.updatePermissions(args.id, args.permissions);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async updateUserAnonymity(_, args: IUserMutateArguments, context: User): Promise<User> {
            if (context.permissions & UserPermissions.Admin) {
                return User.updateAnonymity(args.id, args.anonymousCandidate, args.anonymousCandidate);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        createMouseStrain(_, args: IMouseStrainMutateArguments, context: User): Promise<EntityMutateOutput<MouseStrain>> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.createWith(args.mouseStrain);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        updateMouseStrain(_, args: IMouseStrainMutateArguments, context: User): Promise<EntityMutateOutput<MouseStrain>> {
            if (context.permissions & UserPermissions.Edit) {
                return MouseStrain.updateWith(args.mouseStrain);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        createInjectionVirus(_, args: IInjectionVirusMutateArguments, context: User): Promise<EntityMutateOutput<InjectionVirus>> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.createWith(args.injectionVirus);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        updateInjectionVirus(_, args: IInjectionVirusMutateArguments, context: User): Promise<EntityMutateOutput<InjectionVirus>> {
            if (context.permissions & UserPermissions.Edit) {
                return InjectionVirus.updateWith(args.injectionVirus);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        createFluorophore(_, args: IFluorophoreMutateArguments, context: User): Promise<EntityMutateOutput<Fluorophore>> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.createWith(args.fluorophore);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        updateFluorophore(_, args: IFluorophoreMutateArguments, context: User): Promise<EntityMutateOutput<Fluorophore>> {
            if (context.permissions & UserPermissions.Edit) {
                return Fluorophore.updateWith(args.fluorophore);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        createInjection(_, args: IInjectionMutateArguments, context: User): Promise<EntityMutateOutput<Injection>> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.createWith(args.injectionInput);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        updateInjection(_, args: IInjectionMutateArguments, context: User): Promise<EntityMutateOutput<Injection>> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.updateWith(args.injectionInput);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        deleteInjection(_, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Injection.deleteFor(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        createSample(_, args: ISampleMutateArguments, context: User): Promise<EntityMutateOutput<Sample>> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.createWith(args.sample);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        updateSample(_, args: ISampleMutateArguments, context: User): Promise<EntityMutateOutput<Sample>> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.updateWith(args.sample);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        deleteSample(_, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Sample.deleteFor(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        createNeuron(_, args: INeuronMutateArguments, context: User): Promise<EntityMutateOutput<Neuron>> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.createWith(args.neuron);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        updateNeuron(_, args: INeuronMutateArguments, context: User): Promise<EntityMutateOutput<Neuron>> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.updateWith(args.neuron);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        deleteNeuron(_, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            if (context.permissions & UserPermissions.Edit) {
                return Neuron.deleteFor(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        uploadSwc(_, args: ITracingUploadArguments, context: User): Promise<IUploadOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Tracing.createApprovedTracing(context.id, args.neuronId, args.structureId, args.file);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        requestReconstruction(_, args: IIdOnlyArguments, context: User): Promise<Neuron> {
            if (context.permissions & UserPermissions.ViewReconstructions) {
                return Neuron.requestAnnotation(args.id, context);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async requestReconstructionHold(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.markAnnotationOnHold(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async cancelReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.cancelAnnotation(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async updateReconstruction(_, args: IMarkReconstructionCompleteArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review || await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        async requestReconstructionReview(_, args: IMarkReconstructionCompleteArguments, context: User): Promise<IErrorOutput> {
            if (await Reconstruction.isUserAnnotator(args.id, context.id)) {
                return Reconstruction.updateReconstruction(args.id, args.duration, args.length, args.notes, args.checks, true);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        approveReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.approveAnnotation(args.id, context.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        declineReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.declineAnnotation(args.id, context.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },

        completeReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            if (context.permissions & UserPermissions.Review) {
                return Reconstruction.completeAnnotation(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
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
        mouseStrain(sample: Sample, _, __): Promise<MouseStrain> {
            return sample.getMouseStrain();
        },
        neurons(sample: Sample): Promise<Neuron[]> {
            return sample.getNeurons();
        },
        injections(sample: Sample): Promise<Injection[]> {
            return sample.getInjections();
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
        async tracingStructure(tracing, _, context: User): Promise<TracingStructure> {
            const result: Tracing = await Tracing.findByPk(tracing.id);
            return result ? result.getTracingStructure() : null;
        },
        reconstruction(tracing, _, context: User): Promise<Reconstruction> {
            return Reconstruction.findByPk(tracing.reconstructionId);
        },
        soma(tracing, _, context: User): Promise<TracingNode> {
            return TracingNode.findByPk(tracing.somaNodeId);
        }
    },
    TracingNode: {
        brainStructure(node, _, context: User): Promise<BrainArea> {
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
        }
    }
};
