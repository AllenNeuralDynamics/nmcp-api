import {User, UserPermissions} from "../models/user";
import {Precomputed} from "../models/precomputed";
import {IIdOnlyArguments} from "./openResolvers";
import {Reconstruction} from "../models/reconstruction";
import {GraphQLError} from "graphql/error";
import {Neuron} from "../models/neuron";

const InternalPermission = UserPermissions.InternalSystem;

interface IPrecomputedUpdateArguments {
    id: string;
    version: number;
    generatedAt: number;
}

/**
 * Functionality that should only be authorized to other internal services and not to a remote client.
 */
export const internalResolvers = {
    Query: {
        reconstructionData(_, args: IIdOnlyArguments, context: User): Promise<string> {
            if (context.permissions == InternalPermission) {
                return Reconstruction.getAsData(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        neuronReconstructionData(_, args: IIdOnlyArguments, context: User): Promise<string> {
            if (context.permissions == InternalPermission) {
                return Neuron.getReconstructionsAsData(args.id);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        pendingPrecomputed(_, __, context: User): Promise<Precomputed[]> {
            if (context.permissions == InternalPermission) {
                return Precomputed.getPending();
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
        updatePrecomputed(_, args: IPrecomputedUpdateArguments, context: User): Promise<Precomputed> {
            if (context.permissions == InternalPermission) {
                return Precomputed.markAsGenerated(args.id, args.version, args.generatedAt);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        },
        invalidatePrecomputed(_, args: any, context: User): Promise<string[]> {
            if (context.permissions == InternalPermission) {
                return Precomputed.invalidate(args.ids);
            }

            throw new GraphQLError('User is not authenticated', {
                extensions: {
                    code: 'UNAUTHENTICATED',
                    http: {status: 401},
                },
            });
        }
    }
};
