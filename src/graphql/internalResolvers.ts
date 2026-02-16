import {User} from "../models/user";
import {Precomputed, PrecomputedUpdateShape} from "../models/precomputed";
import {SpecimenSpacePrecomputed} from "../models/specimenSpacePrecomputed";
import {Reconstruction} from "../models/reconstruction";
import {AtlasReconstruction, JsonParts} from "../models/atlasReconstruction";
import {PortalJsonReconstructionContainer} from "../io/portalJson";

// noinspection JSUnusedGlobalSymbols
/**
 * Functionality that should only be authorized to other internal services and not to a remote client.
 */
export const internalResolvers = {
    Query: {
        // Used by export and precomputed worker services
        reconstructionAsJson(_: any, args: { id: string, options: JsonParts }, user: User): Promise<PortalJsonReconstructionContainer | null> {
            return AtlasReconstruction.getAsJSON(user, args.id, args.options);
        },

        specimenSpaceReconstructionAsJson(_: any, args: { id: string }, user: User): Promise<PortalJsonReconstructionContainer | null> {
            return Reconstruction.getAsJSONForAtlasId(user, args.id);
        },

        // Used by precomputed worker service
        pendingPrecomputed(_: any, __: any, user: User): Promise<Precomputed[]> {
            return Precomputed.getPending(user);
        },
        specimenSpacePendingPrecomputed(_: any, __: any, user: User): Promise<SpecimenSpacePrecomputed[]> {
            return SpecimenSpacePrecomputed.getPending(user);
        },
    },
    Mutation: {
        // Used by precomputed worker service
        updatePrecomputed(_: any, args: PrecomputedUpdateShape, user: User): Promise<Precomputed> {
            return Precomputed.updateGeneration(user, args.id, args.status, args.version, args.generatedAt);
        },
        updateSpecimenSpacePrecomputed(_: any, args: PrecomputedUpdateShape, user: User): Promise<SpecimenSpacePrecomputed> {
            return SpecimenSpacePrecomputed.updateGeneration(user, args.id, args.status, args.version, args.generatedAt);
        }
    }
};
