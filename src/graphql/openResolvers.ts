import {Kind} from "graphql/language";
import {GraphQLScalarType} from "graphql/type";

import {IQueryOperator, operators} from "../models/queryOperator";
import {NearestNodeOutput, AtlasReconstruction} from "../models/atlasReconstruction";
import {PredicateType} from "../models/queryPredicate";
import {AtlasStructure, AtlasStructureQueryInput} from "../models/atlasStructure";
import {User} from "../models/user";
import {NodeStructure} from "../models/nodeStructure";
import {NeuronStructure} from "../models/neuronStructure";
import {IQueryDataPage, Neuron, NeuronQueryInput} from "../models/neuron";
import {SearchContextInput, SearchContext} from "../models/searchContext";
import {Collection} from "../models/collection";
import {EntityQueryOutput} from "../models/baseModel";
import {Specimen, SpecimenQueryArgs} from "../models/specimen";
import {Genotype} from "../models/genotype";
import {Injection} from "../models/injection";
import {InjectionVirus} from "../models/injectionVirus";
import {Fluorophore} from "../models/fluorophore";
import {Reconstruction, PublishedReconstructionQueryResponse} from "../models/reconstruction";
import {getSystemSettings, SystemSettings} from "../models/systemSettings";

// const debug = require("debug")("nmcp:api:open-resolvers");

export type IdArgs = {
    id: string;
}

type AtlasQueryArgs = {
    input: AtlasStructureQueryInput;
}

type CandidateQueryArgs = {
    input: NeuronQueryInput;
    includeInProgress: boolean;
}

type NearestNodeArgs = {
    id: string;         // reconstruction id
    location: number[]; // expected distance [x, y, z]
}

type SearchNeuronsArguments = {
    context: SearchContextInput;
}

// noinspection JSUnusedGlobalSymbols
/**
 * Resolvers that do not require any type of user authentication.  These are essentially just what is needed to use the viewer and explore candidates
 * without signing in.
 *
 * IF YOU ARE ADDING A MUTATION OTHER THAN THE REQUEST ACCESS MUTATION, CONSIDER WHAT YOU ARE DOING CAREFULLY
 */
export const openResolvers = {
    Query: {
        user(_: any, __: any, context: User): User {
            return context;
        },

        systemSettings(): Promise<SystemSettings> {
            return getSystemSettings();
        },

        queryOperators(): IQueryOperator[] {
            return operators;
        },

        nodeStructures(_: any, __: any, ___: User): Promise<NodeStructure[]> {
            return NodeStructure.findAll({});
        },

        neuronStructures(_: any, __: any, ___: User): Promise<NeuronStructure[]> {
            return NeuronStructure.findAll({});
        },

        async atlasStructures(_: any, args: AtlasQueryArgs): Promise<AtlasStructure[]> {
            const output = await AtlasStructure.getAll(args.input);

            return output.items;
        },

        atlasStructure(_: any, args: IdArgs): Promise<AtlasStructure> {
            return AtlasStructure.findByPk(args.id);
        },

        collections(): Promise<Collection[]> {
            return Collection.findAll();
        },

        genotypes(_: any): Promise<Genotype[]> {
            return Genotype.findAll();
        },

        fluorophores(_: any): Promise<Fluorophore[]> {
            return Fluorophore.findAll();
        },

        injectionViruses(_: any): Promise<InjectionVirus[]> {
            return InjectionVirus.findAll();
        },

        specimens(_: any, args: { queryArgs: SpecimenQueryArgs }): Promise<EntityQueryOutput<Specimen>> {
            return Specimen.getAll(args.queryArgs);
        },

        neuron(_: any, args: IdArgs): Promise<Neuron> {
            return Neuron.findByPk(args.id);
        },

        candidateNeurons(_: any, args: CandidateQueryArgs): Promise<EntityQueryOutput<Neuron>> {
            return Neuron.getCandidateNeurons(args.input, args.includeInProgress);
        },

        nearestNode(_: any, args: NearestNodeArgs, __: User): Promise<NearestNodeOutput> {
            return AtlasReconstruction.nearestNode(args.id, args.location);
        },

        publishedReconstructions(_: any, args: { offset: number, limit: number }, user: User): Promise<PublishedReconstructionQueryResponse> {
            return Reconstruction.getAllPublished(user, args.offset, args.limit);
        },

        searchNeurons(_: any, args: SearchNeuronsArguments, __: User): Promise<IQueryDataPage> {
            return Neuron.getNeuronsWithPredicates(new SearchContext(args.context));
        }
    },
    Injection: {
        injectionVirus(injection: Injection): Promise<InjectionVirus> {
            return injection.getInjectionVirus();
        },
        fluorophore(injection: Injection): Promise<Fluorophore> {
            return injection.getFluorophore();
        },
        atlasStructure(injection: Injection): Promise<AtlasStructure> {
            return injection.getAtlasStructure();
        },
        specimen(injection: Injection): Promise<Specimen> {
            return injection.getSpecimen();
        },
    },
    Specimen: {
        async neuronCount(specimen: Specimen): Promise<number> {
            return specimen.neuronCount();
        },
        genotype(specimen: Specimen, _: any, __: any): Promise<Genotype> {
            return specimen.getGenotype();
        },
        injections(specimen: Specimen): Promise<Injection[]> {
            return specimen.getInjections();
        },
        neurons(specimen: Specimen): Promise<Neuron[]> {
            return specimen.getNeurons();
        }
    },
    Neuron: {
        reconstructionCount(neuron: any): Promise<number> {
            return Reconstruction.count({where: {neuronId: neuron.id}})
        },
        atlasStructure(neuron: Neuron): Promise<AtlasStructure> {
            return neuron.getAtlasStructure();
        },
        specimen(neuron: Neuron): Promise<Specimen> {
            return neuron.getSpecimen();
        },
        reconstructions(neuron: Neuron): Promise<Reconstruction[]> {
            return neuron.getSpecimenReconstruction();
        },
        published(neuron: Neuron): Promise<AtlasReconstruction> {
            return neuron.published();
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
