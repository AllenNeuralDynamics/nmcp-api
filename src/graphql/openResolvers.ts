import {Kind} from "graphql/language";

import {GraphQLScalarType} from "graphql/type";
import {IQueryOperator, operators} from "../models/queryOperator";
import {NearestNodeOutput, Reconstruction} from "../models/reconstruction";
import {ServiceOptions} from "../options/serviceOptions";
import {PredicateType} from "../models/queryPredicate";
import {BrainArea, CompartmentQueryInput} from "../models/brainArea";
import {User} from "../models/user";
import {StructureIdentifier} from "../models/structureIdentifier";
import {TracingStructure} from "../models/tracingStructure";
import {staticApiClient} from "../data-access/staticApiService";
import {IQueryDataPage, Neuron} from "../models/neuron";
import {ISearchContextInput, SearchContext} from "../models/searchContext";
import {Collection} from "../models/collection";
import {TracingNode} from "../models/tracingNode";

const debug = require("debug")("mnb:api:resolvers");

export interface IIdOnlyArguments {
    id: string;
}

interface IBrainAreaQueryArguments {
    input: CompartmentQueryInput;
}

type NearestNodeArguments = {
    id: string; // reconstruction id
    location: number[]; // expected length 3 (x, y, z)
}

type SearchNeuronsArguments = {
    context: ISearchContextInput;
}

// noinspection JSUnusedGlobalSymbols
/**
 * Resolvers that do not require any type of user authentication.  These are essentially just what is needed to use the viewer without signing in.
 */
export const openResolvers = {
    Query: {
        user(_: any, __: any, context: User): User {
            return context;
        },

        systemSettings(): any {
            return getSystemSettings();
        },

        queryOperators(): IQueryOperator[] {
            return operators;
        },

        structureIdentifiers(_: any, __: any, ___: User): Promise<StructureIdentifier[]> {
            return StructureIdentifier.findAll({});
        },

        tracingStructures(_: any, __: any, ___: User): Promise<TracingStructure[]> {
            return TracingStructure.findAll({});
        },

        async brainAreas(_: any, args: IBrainAreaQueryArguments): Promise<BrainArea[]> {
            const output = await BrainArea.getAll(args.input);

            return output.items;
        },

        brainArea(_: any, args: IIdOnlyArguments): Promise<BrainArea> {
            return BrainArea.findByPk(args.id);
        },

        async tomographyMetadata(_: any, __: any, ___: User): Promise<[]> {
            try {
                const resp = await staticApiClient.querySampleTomography();
                debug("tomography loaded")
                return resp.data.tomographyMetadata;
            } catch (err) {
                debug("failed tomography query")
                debug(err);
            }

            return [];
        },

        collections(): Promise<Collection[]> {
            return Collection.findAll();
        },

        async nearestNode(_: any, args: NearestNodeArguments, __: User): Promise<NearestNodeOutput> {
            return Reconstruction.nearestNode(args.id, args.location);
        },

        async searchNeurons(_: any, args: SearchNeuronsArguments, __: User): Promise<IQueryDataPage> {
            try {
                return Neuron.getNeuronsWithPredicates(new SearchContext(args.context));
            } catch (err) {
                console.log(err);
            }
        }
    },
    Date: new GraphQLScalarType({
        name: "Date",
        description: "Date custom scalar type",
        parseValue: (value: number) => {
            return new Date(value); // value from the client
        },
        serialize: (value: Date) => {
            return value.getTime(); // value sent to the client
        },
        parseLiteral: (ast) => {
            if (ast.kind === Kind.INT) {
                return new Date(parseInt(ast.value, 10)); // ast value is always in string format
            }
            return null;
        },
    }),
    PredicateType: {
        ANATOMICAL: PredicateType.AnatomicalRegion,
        CUSTOM: PredicateType.CustomRegion,
        ID: PredicateType.IdOrDoi,
    }
}

interface ISystemSettings {
    apiVersion: string;
    neuronCount: number;
    features: {
        enableUpdatedViewer: boolean;
    }
}

async function getSystemSettings(): Promise<ISystemSettings> {
    const reconstructionCount = Reconstruction.reconstructionCount();

    return {
        apiVersion: ServiceOptions.version,
        neuronCount: reconstructionCount,
        features: {
            enableUpdatedViewer: process.env.NODE_ENV != "production"
        }
    }
}
