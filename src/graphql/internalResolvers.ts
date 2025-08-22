import {User, UserPermissions} from "../models/user";
import {Precomputed} from "../models/precomputed";
import {IIdOnlyArguments} from "./openResolvers";
import {Reconstruction, ReconstructionDataJSON, ReconstructionDataChunked} from "../models/reconstruction";
import {GraphQLError} from "graphql/error";
import {Neuron} from "../models/neuron";

const InternalPermission = UserPermissions.InternalSystem;

interface IPrecomputedUpdateArguments {
    id: string;
    version: number;
    generatedAt: number;
}

interface IReconstructionDataChunkedArguments {
    id: string;
    input?: {
        parts?: string[];
        axonOffset?: number;
        axonLimit?: number;
        dendriteOffset?: number;
        dendriteLimit?: number;
    };
}

/**
 * Functionality that should only be authorized to other internal services and not to a remote client.
 */
export const internalResolvers = {
    Query: {
        reconstructionData(_: any, args: IIdOnlyArguments, context: User): Promise<string> {
            if (context.permissions == InternalPermission) {
                return Reconstruction.getAsData(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        reconstructionDataJSON(_: any, args: IIdOnlyArguments, context: User): Promise<ReconstructionDataJSON | null> {
            if (context.permissions == InternalPermission) {
                return Reconstruction.getAsJSON(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        reconstructionDataChunked(_: any, args: IReconstructionDataChunkedArguments, context: User): Promise<ReconstructionDataChunked | null> {
            if (context.permissions == InternalPermission) {
                return Reconstruction.getAsDataChunked(args.id, args.input || {});
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        neuronReconstructionData(_: any, args: IIdOnlyArguments, context: User): Promise<string> {
            if (context.permissions == InternalPermission) {
                return Neuron.getReconstructionData(args.id);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        pendingPrecomputed(_: any, __: any, context: User): Promise<Precomputed[]> {
            if (context.permissions == InternalPermission) {
                return Precomputed.getPending();
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
        updatePrecomputed(_: any, args: IPrecomputedUpdateArguments, context: User): Promise<Precomputed> {
            if (context.permissions == InternalPermission) {
                return Precomputed.markAsGenerated(args.id, args.version, args.generatedAt);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        },
        invalidatePrecomputed(_: any, args: any, context: User): Promise<string[]> {
            if (context.permissions == InternalPermission) {
                return Precomputed.invalidate(args.ids);
            }

            throw new GraphQLError("User is not authenticated", {
                extensions: {
                    code: "UNAUTHENTICATED",
                    http: {status: 401},
                },
            });
        }
    }
};
