import {Kind} from "graphql/language";
import {GraphQLScalarType} from "graphql/type";

import {QueryOperator, operators} from "../models/queryOperator";
import {NearestNodeOutput, AtlasReconstruction} from "../models/atlasReconstruction";
import {PredicateType} from "../models/queryPredicate";
import {AtlasStructure, AtlasStructureQueryInput} from "../models/atlasStructure";
import {Atlas} from "../models/atlas";
import {AtlasKind} from "../models/atlasKind";
import {User} from "../models/user";
import {NodeStructure} from "../models/nodeStructure";
import {NeuronStructure} from "../models/neuronStructure";
import {CandidateNeuronLocations, SearchOutputPage, Neuron, NeuronQueryInput} from "../models/neuron";
import {SearchContextInput, SearchContext} from "../models/searchContext";
import {Collection} from "../models/collection";
import {EntityQueryOutput} from "../models/baseModel";
import {Specimen, SpecimenQueryArgs} from "../models/specimen";
import {Genotype} from "../models/genotype";
import {Injection} from "../models/injection";
import {InjectionVirus} from "../models/injectionVirus";
import {Fluorophore} from "../models/fluorophore";
import {Annotation, PublishedReconstructionQueryResponse} from "../models/annotation";
import {AnnotationStatus} from "../models/annotationStatus";
import {getSystemSettings, SystemSettings} from "../models/systemSettings";
import {AccessRequest, AccessRequestShape, RequestAccessResponse} from "../models/accessRequest";
import {getNeuronVersionHistory} from "../models/neuronVersionHistory";
import {AtlasQualityControl} from "../models/atlasQualityControl";
import {QualityOutputShape} from "../data-access/qualityCheckService";
import {getReconstructionMetrics, ReconstructionMetrics} from "../data-access/reconstructionMetricsService";
import {FieldResolvers, RequestContext} from "./requestContext";

// noinspection JSUnusedGlobalSymbols
/**
 * Resolvers that do not require any type of user authentication.  These are essentially just what is needed to use the viewer and explore candidates
 * without signing in.
 *
 * IF YOU ARE ADDING A MUTATION OTHER THAN THE REQUEST ACCESS MUTATION, CONSIDER WHAT YOU ARE DOING CAREFULLY.
 */
export const openResolvers = {
    Query: {
        user(_: any, __: any, {user}: RequestContext): User {
            return user;
        },

        systemSettings(): Promise<SystemSettings> {
            return getSystemSettings();
        },

        queryOperators(): QueryOperator[] {
            return operators;
        },

        nodeStructures(_: any, __: any, ___: RequestContext): Promise<NodeStructure[]> {
            return NodeStructure.findAll({});
        },

        neuronStructures(_: any, __: any, ___: RequestContext): Promise<NeuronStructure[]> {
            return NeuronStructure.findAll({});
        },

        atlasKinds(): Promise<AtlasKind[]> {
            return AtlasKind.getAll();
        },

        atlases(): Atlas[] {
            return Atlas.getAll();
        },

        atlasStructures(_: any, args: { atlasId: string }): Promise<AtlasStructure[]> {
            return AtlasStructure.getForAtlas(args.atlasId);
        },

        atlasStructure(_: any, args: { id: string }): Promise<AtlasStructure> {
            return AtlasStructure.findByPk(args.id);
        },

        collections(): Promise<Collection[]> {
            return Collection.findAll();
        },

        genotypes(_: any): Promise<Genotype[]> {
            return Genotype.findAllInUse();
        },

        fluorophores(_: any): Promise<Fluorophore[]> {
            return Fluorophore.findAll();
        },

        injectionViruses(_: any): Promise<InjectionVirus[]> {
            return InjectionVirus.findAll();
        },

        specimen(_: any, args: { id: string }): Promise<Specimen> {
            return Specimen.findByPk(args.id);
        },

        specimens(_: any, args: { input: SpecimenQueryArgs }): Promise<EntityQueryOutput<Specimen>> {
            return Specimen.getAll(args.input);
        },

        neuron(_: any, args: { id: string }): Promise<Neuron> {
            return Neuron.findByPk(args.id);
        },

        candidateNeurons(_: any, args: { input: NeuronQueryInput, includeInProgress: boolean, excludedAnnotationStatuses?: AnnotationStatus[] }): Promise<EntityQueryOutput<Neuron>> {
            // An explicit null from the client becomes undefined so the model's default applies.
            return Neuron.getCandidateNeurons(args.input, args.includeInProgress, args.excludedAnnotationStatuses ?? undefined);
        },

        candidateNeuronLocations(_: any, args: { input: NeuronQueryInput, includeInProgress: boolean, excludedAnnotationStatuses?: AnnotationStatus[], after?: string, chunkSize?: number }): Promise<CandidateNeuronLocations> {
            return Neuron.getCandidateNeuronLocations(args.input, args.includeInProgress, args.excludedAnnotationStatuses ?? undefined, args.after ?? null, args.chunkSize ?? null);
        },

        candidateNeuronOffset(_: any, args: { id: string, input: NeuronQueryInput, includeInProgress: boolean, excludedAnnotationStatuses?: AnnotationStatus[] }): Promise<number | null> {
            return Neuron.getCandidateNeuronOffset(args.id, args.input, args.includeInProgress, args.excludedAnnotationStatuses ?? undefined);
        },

        nearestNode(_: any, args: { id: string, location: number[] }, __: RequestContext): Promise<NearestNodeOutput> {
            return AtlasReconstruction.nearestNode(args.id, args.location);
        },

        reconstructionMetrics(_: any, args: { id: string }): Promise<ReconstructionMetrics | null> {
            return getReconstructionMetrics(args.id);
        },

        publishedReconstructions(_: any, args: { offset: number, limit: number }, {user}: RequestContext): Promise<PublishedReconstructionQueryResponse> {
            return Annotation.getAllPublished(user, args.offset, args.limit);
        },

        searchNeurons(_: any, args: { context: SearchContextInput }, __: RequestContext): Promise<SearchOutputPage> {
            return Neuron.getNeuronsWithPredicates(new SearchContext(args.context));
        },

        neuronVersionHistory(_: any, args: { neuronId: string }, __: RequestContext) {
            return getNeuronVersionHistory(args.neuronId);
        },

        // Deliberately open at every status, the stored output and its QC-portal document included.
        atlasQualityControl(_: any, args: { id: string }, context: RequestContext): Promise<AtlasQualityControl> {
            return AtlasQualityControl.findByPk(args.id);
        },
    } satisfies FieldResolvers,
    Mutation: {
        requestAccess(_: any, args: { request: AccessRequestShape }, {user}: RequestContext): Promise<RequestAccessResponse> {
            return AccessRequest.createRequest(user, args.request);
        }
    } satisfies FieldResolvers,
    AtlasKind: {
        atlases(atlasKind: AtlasKind): Atlas[] {
            return Atlas.getForKind(atlasKind.id);
        }
    } satisfies FieldResolvers,
    Atlas: {
        atlasKind(atlas: Atlas): Promise<AtlasKind> {
            return atlas.getAtlasKind();
        },
        atlasStructures(atlas: Atlas): Promise<AtlasStructure[]> {
            return AtlasStructure.getForAtlas(atlas.id);
        }
    } satisfies FieldResolvers,
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
    } satisfies FieldResolvers,
    Specimen: {
        async neuronCount(specimen: Specimen): Promise<number> {
            return specimen.neuronCount();
        },
        collection(specimen: Specimen): Promise<Collection> {
            return specimen.getCollection();
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
    } satisfies FieldResolvers,
    Neuron: {
        annotationCount(neuron: Neuron, _: any, {loaders}: RequestContext): Promise<number> {
            return loaders.annotationCount.load(neuron.id);
        },
        atlasStructure(neuron: Neuron, _: any, {loaders}: RequestContext): Promise<AtlasStructure> {
            return Promise.resolve(neuron.AtlasStructure ?? (neuron.atlasStructureId ? loaders.atlasStructure.load(neuron.atlasStructureId) : null));
        },
        specimen(neuron: Neuron, _: any, {loaders}: RequestContext): Promise<Specimen> {
            // Reusing the include relies on every Neuron query that includes Specimen selecting all of its columns; a
            // partial include would hand the client nulls for the fields it left out.
            return Promise.resolve(neuron.Specimen ?? (neuron.specimenId ? loaders.specimen.load(neuron.specimenId) : null));
        },
        annotations(neuron: Neuron, _: any, {loaders}: RequestContext): Promise<Annotation[]> {
            return loaders.annotations.load(neuron.id);
        },
        published(neuron: Neuron, _: any, {loaders}: RequestContext): Promise<Annotation> {
            return loaders.published.load(neuron.id);
        },
        untraceable(neuron: Neuron, _: any, {loaders}: RequestContext): Promise<boolean> {
            return loaders.untraceable.load(neuron.id);
        }
    } satisfies FieldResolvers,
    AtlasReconstruction: {
        annotation(reconstruction: AtlasReconstruction): Promise<Annotation> {
            return Promise.resolve(reconstruction.Annotation ?? reconstruction.getAnnotation());
        },
        async neuron(reconstruction: AtlasReconstruction): Promise<Neuron> {
            const r = await Annotation.findByPk(reconstruction.annotationId);

            if (r) {
                return await Neuron.findByPk(r.neuronId);
            }

            return null;
        }
    } satisfies FieldResolvers,
    Date: new GraphQLScalarType({
        name: "Date",
        description: "Date custom scalar type",
        parseValue: (value: number) => {
            return new Date(value); // value from the client
        },
        serialize: (value: Date | string) => {
            const ms = typeof value === "string" ? Date.parse(value) : value?.getTime();
            return isNaN(ms) ? 0 : ms;
        },
        parseLiteral: (ast) => {
            if (ast.kind === Kind.INT) {
                return new Date(parseInt(ast.value, 10)); // ast value is always in string format
            }
            return null;
        },
    }),
    JSON: new GraphQLScalarType({
        name: "JSON",
        description: "Arbitrary JSON, returned exactly as stored",
        serialize: (value: unknown) => value
    }),
    QualityOutput: {
        data(output: QualityOutputShape): QualityOutputShape {
            return output;
        }
    } satisfies FieldResolvers,
    PredicateType: {
        ANATOMICAL: PredicateType.AnatomicalRegion,
        CUSTOM: PredicateType.CustomRegion,
        ID: PredicateType.IdOrDoi,
    }
}
