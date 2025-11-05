import {User} from "../models/user";
import {Precomputed, PrecomputedUpdateShape} from "../models/precomputed";
import {AtlasReconstruction, JsonParts} from "../models/atlasReconstruction";
import {PortalJsonReconstructionContainer} from "../io/portalJson";

// noinspection JSUnusedGlobalSymbols
/**
 * Functionality that should only be authorized to other internal services and not to a remote client.
 */
export const internalResolvers = {
    Query: {
        // Used by precomputed worker service and export service.
        reconstructionAsJSON(_: any, args: { id: string, options: JsonParts }, user: User): Promise<PortalJsonReconstructionContainer | null> {
            return AtlasReconstruction.getAsJSON(user, args.id, args.options);
        },

        // Used by precomputed worker service
        pendingPrecomputed(_: any, __: any, user: User): Promise<Precomputed[]> {
            return Precomputed.getPending(user);
        }
    },
    Mutation: {
        // Used by precomputed worker service
        updatePrecomputed(_: any, args: PrecomputedUpdateShape, user: User): Promise<Precomputed> {
            return Precomputed.updateGeneration(user, args.id, args.status, args.version, args.generatedAt);
        }
    }
};
