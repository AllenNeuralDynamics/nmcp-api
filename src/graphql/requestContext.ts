import {User} from "../models/user";
import {createNeuronLoaders, NeuronLoaders} from "./neuronLoaders";

export type RequestContext = {
    user: User;
    loaders: NeuronLoaders;
};

export type FieldResolvers = Record<string, (parent: any, args: any, context: RequestContext, info?: any) => unknown>;

// Fresh loaders per call, so concurrent requests never share a batch or each other's failures.
export function createRequestContext(user: User): RequestContext {
    return {user, loaders: createNeuronLoaders()};
}
