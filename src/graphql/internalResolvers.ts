import {FieldResolvers, RequestContext} from "./requestContext";
import {Precomputed, PrecomputedUpdateShape} from "../models/precomputed";
import {SpecimenSpacePrecomputed} from "../models/specimenSpacePrecomputed";
import {SpecimenSpaceReconstruction} from "../models/specimenSpaceReconstruction";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {RawReconstruction} from "../models/rawReconstruction";
import {PortalReconstruction} from "../io/portalFormat";
import {RecentRequest, recentRequestLog} from "../util/recentRequestLog";

// noinspection JSUnusedGlobalSymbols
/**
 * Functionality that should only be authorized to other internal services and not to a remote client.
 */
export const internalResolvers = {
    Query: {
        // Used by export and precomputed worker services
        exportedSpecimenReconstruction(_: any, args: { id: string }, {user}: RequestContext): Promise<PortalReconstruction | null> {
            return SpecimenSpaceReconstruction.toPortalFormat(user, args.id);
        },

        exportedAtlasReconstruction(_: any, args: { id: string }, {user}: RequestContext): Promise<PortalReconstruction | null> {
            return AtlasReconstruction.toPortalFormat(user, args.id);
        },

        exportedRawReconstruction(_: any, args: { id: string }, {user}: RequestContext): Promise<PortalReconstruction | null> {
            return RawReconstruction.toPortalFormat(user, args.id);
        },

        // Used by precomputed worker service
        pendingPrecomputed(_: any, __: any, {user}: RequestContext): Promise<Precomputed[]> {
            return Precomputed.getPending(user);
        },
        specimenSpacePendingPrecomputed(_: any, __: any, {user}: RequestContext): Promise<SpecimenSpacePrecomputed[]> {
            return SpecimenSpacePrecomputed.getPending(user);
        },

        // Deployment diagnostics - confirms whether client addresses are resolving distinctly or collapsing onto the
        // gateway.
        recentRequestAddresses(_: any, __: any, {user}: RequestContext): RecentRequest[] {
            return recentRequestLog.recent(user);
        },
    } satisfies FieldResolvers,
    Mutation: {
        // Used by precomputed worker service
        updatePrecomputed(_: any, args: PrecomputedUpdateShape, {user}: RequestContext): Promise<Precomputed> {
            return Precomputed.updateGeneration(user, args.id, args.status, args.version, args.generatedAt);
        },
        updateSpecimenSpacePrecomputed(_: any, args: PrecomputedUpdateShape, {user}: RequestContext): Promise<SpecimenSpacePrecomputed> {
            return SpecimenSpacePrecomputed.updateGeneration(user, args.id, args.status, args.version, args.generatedAt);
        }
    } satisfies FieldResolvers
};
