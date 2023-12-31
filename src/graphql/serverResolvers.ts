import {GraphQLScalarType} from "graphql";
import {Kind} from "graphql/language";

const GraphQLUpload = require('graphql-upload/GraphQLUpload.js');

import {IQueryDataPage, IUpdateAnnotationOutput, Neuron, NeuronInput, NeuronQueryInput} from "../models/neuron";

import {BrainArea, CompartmentMutationData, CompartmentQueryInput} from "../models/brainArea";
import {MouseStrain, MouseStrainInput, MouseStrainQueryInput} from "../models/mouseStrain";
import {SampleInput, Sample, SampleQueryInput} from "../models/sample";
import {DeleteOutput, EntityCount, EntityCountOutput, EntityMutateOutput, EntityQueryOutput, EntityType} from "../models/baseModel";
import {StructureIdentifier} from "../models/structureIdentifier";
import {TracingStructure} from "../models/tracingStructure";
import {ITracingInput, Tracing, TransformResult} from "../models/tracing";
import {TracingNode} from "../models/tracingNode";
import {Injection, InjectionInput, InjectionQueryInput} from "../models/injection";
import {Fluorophore, FluorophoreInput, FluorophoreQueryInput} from "../models/fluorophore";
import {InjectionVirus, InjectionVirusInput, InjectionVirusQueryInput} from "../models/injectionVirus";
import {IQueryOperator, operators} from "../models/queryOperator";
import {ServiceOptions} from "../options/serviceOptions";
import {SearchScope} from "../models/SearchScope";
import {staticApiClient} from "../data-access/staticApiService";
import {PredicateType} from "../models/queryPredicate";
import {CcfVersion, ISearchContextInput, SearchContext} from "../models/searchContext";
import {User} from "../models/user";
import {Reconstruction} from "../models/reconstruction";

//
// GraphQL arguments
//

interface IIdOnlyArguments {
    id: string;
}

export interface IUploadFile {
    filename: string;
    encoding: string;
    mimetype: string;
    stream: any;
}

//
// General query
//

interface IIdsArguments {
    ids: string[];
}

interface IBrainAreaQueryArguments {
    input: CompartmentQueryInput;
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

interface SampleIdArguments {
    sampleId: string;
}

interface ICountsArguments {
    ids: string[];
}

interface IAnnotationUploadArguments {
    neuronId: string;
    file: Promise<IUploadFile>;
}

interface ITracingUploadArguments {
    neuronId: string;
    structureId: string;
    duration: number;
    length: number;
    file: Promise<IUploadFile>;
}

export interface IReconstructionPageInput {
    offset: number;
    limit: number;
}

interface IReconstructionArguments {
    pageInput: IReconstructionPageInput;
}

export interface IReconstructionPage {
    offset: number;
    limit: number;
    totalCount: number;
    matchCount: number;
    reconstructions: Reconstruction[];
}

export interface IUploadOutput {
    tracing: Tracing;
    error: Error;
}

interface IUpdateTracingArguments {
    tracing: ITracingInput;
}

export interface IUpdateTracingOutput {
    tracing: Tracing;
    error: Error;
}

type SearchNeuronsArguments = {
    context: ISearchContextInput;
}

//
// General mutate
//
interface IBrainAreaMutateArguments {
    brainArea: CompartmentMutationData;
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


export interface ITracingsCount {
    tracingId: string;
    count: number;
}

export interface IQueryTracingsCountOutput {
    counts: ITracingsCount[];
    error: Error;
}

export interface IErrorOutput {
    message: string;
    name: string;
}

export const resolvers = {
    Upload: GraphQLUpload,

    Query: {
        systemMessage(): String {
            return systemMessage;
        },
        systemSettings(_, {searchScope}): any {
            return getSystemSettings(searchScope);
        },

        queryOperators(): IQueryOperator[] {
            return operators;
        },

        user(_, args: any, context: User): any {
            return context;
        },

        async brainAreas(_, args: IBrainAreaQueryArguments): Promise<BrainArea[]> {
            const response = await BrainArea.getAll(args.input);

            return response.items;
        },
        brainAreaItems(_, args: IBrainAreaQueryArguments): Promise<EntityQueryOutput<BrainArea>> {
            return BrainArea.getAll(args.input);
        },
        brainArea(_, args: IIdOnlyArguments): Promise<BrainArea> {
            return BrainArea.findByPk(args.id);
        },

        mouseStrains(_, args: IMouseStrainQueryArguments): Promise<MouseStrain[]> {
            return MouseStrain.getAll(args.input);
        },
        mouseStrain(_, args: IIdOnlyArguments): Promise<MouseStrain> {
            return MouseStrain.findByPk(args.id);
        },

        injectionViruses(_, args: IInjectionVirusQueryArguments): Promise<InjectionVirus[]> {
            return InjectionVirus.getAll(args.input);
        },
        injectionVirus(_, args: IIdOnlyArguments): Promise<InjectionVirus> {
            return InjectionVirus.findByPk(args.id);
        },

        fluorophores(_, args: IFluorophoreQueryArguments): Promise<Fluorophore[]> {
            return Fluorophore.getAll(args.input);
        },
        fluorophore(_, args: IIdOnlyArguments): Promise<Fluorophore> {
            return Fluorophore.findByPk(args.id);
        },

        injections(_, args: IInjectionQueryArguments): Promise<Injection[]> {
            return Injection.getAll(args.input);
        },
        injection(_, args: IIdOnlyArguments): Promise<Injection> {
            return Injection.findByPk(args.id);
        },

        samples(_, args: ISampleQueryArguments): Promise<EntityQueryOutput<Sample>> {
            return Sample.getAll(args.input);
        },
        sample(_, args: IIdOnlyArguments): Promise<Sample> {
            return Sample.findByPk(args.id);
        },

        neurons(_, args: INeuronQueryArguments): Promise<EntityQueryOutput<Neuron>> {
            return Neuron.getAll(args.input);
        },
        neuron(_, args: IIdOnlyArguments): Promise<Neuron> {
            return Neuron.findByPk(args.id);
        },
        neuronsForSample(_, args: SampleIdArguments, context: User): Promise<Neuron[]> {
            return Neuron.getNeurons(args.sampleId);
        },

        candidateNeurons(_, args: INeuronQueryArguments, context: User): Promise<EntityQueryOutput<Neuron>> {
            return Neuron.getCandidateNeurons(args.input);
        },

        neuronCountsForSamples(_, args: ICountsArguments): Promise<EntityCountOutput> {
            return Sample.neuronCountsPerSample(args.ids);
        },

        async reconstructionCountsForNeurons(_, args: ICountsArguments): Promise<EntityCountOutput> {
            const counts: EntityCount[] = await Promise.all(args.ids.map(async (id) => {
                return {
                    id: id,
                    count: await Reconstruction.getCountForNeuron(id)
                }
            }));

            return {
                entityType: EntityType.Tracing,
                counts: counts,
                error: null
            }
        },

        async structureIdentifiers(_, __, context: User): Promise<StructureIdentifier[]> {
            return StructureIdentifier.findAll({});
        },
        async tracingStructures(_, __, context: User): Promise<TracingStructure[]> {
            return TracingStructure.findAll({});
        },

        async reconstructions(_, args: IReconstructionArguments, context: User): Promise<IReconstructionPage> {
            return Reconstruction.getAll(args.pageInput);
        },

        async reconstructionsForUser(_, __, context: User): Promise<Reconstruction[]> {
            return Reconstruction.getAnnotationsForUser(context.id);
        },

        async reviewableReconstructions(_, __, context: User): Promise<Reconstruction[]> {
            // TODO check permissions of User
            return Reconstruction.getReviewableAnnotations();
        },

        async candidatesForUser(_, __, context: User): Promise<Neuron[]> {
            return Neuron.getCandidateNeuronsForUser(context.id);
        },

        async tomographyMetadata(_, args: any, context: User): Promise<[]> {
            try {
                const resp = await staticApiClient.querySampleTomography();
                return resp.data.tomographyMetadata;
            } catch (err) {
                console.log(err);
            }

            return [];
        },
        async searchNeurons(_, args: SearchNeuronsArguments, context: User): Promise<IQueryDataPage> {
            try {
                return Neuron.getNeuronsWithPredicates(new SearchContext(args.context));
            } catch (err) {
                console.log(err);
            }
        }
    },
    Mutation: {
        updateBrainArea(_, args: IBrainAreaMutateArguments): Promise<EntityMutateOutput<BrainArea>> {
            return BrainArea.updateWith(args.brainArea);
        },

        createMouseStrain(_, args: IMouseStrainMutateArguments): Promise<EntityMutateOutput<MouseStrain>> {
            return MouseStrain.createWith(args.mouseStrain);
        },
        updateMouseStrain(_, args: IMouseStrainMutateArguments): Promise<EntityMutateOutput<MouseStrain>> {
            return MouseStrain.updateWith(args.mouseStrain);
        },

        createInjectionVirus(_, args: IInjectionVirusMutateArguments): Promise<EntityMutateOutput<InjectionVirus>> {
            return InjectionVirus.createWith(args.injectionVirus);
        },
        updateInjectionVirus(_, args: IInjectionVirusMutateArguments): Promise<EntityMutateOutput<InjectionVirus>> {
            return InjectionVirus.updateWith(args.injectionVirus);
        },

        createFluorophore(_, args: IFluorophoreMutateArguments): Promise<EntityMutateOutput<Fluorophore>> {
            return Fluorophore.createWith(args.fluorophore);
        },
        updateFluorophore(_, args: IFluorophoreMutateArguments): Promise<EntityMutateOutput<Fluorophore>> {
            return Fluorophore.updateWith(args.fluorophore);
        },

        createInjection(_, args: IInjectionMutateArguments): Promise<EntityMutateOutput<Injection>> {
            return Injection.createWith(args.injectionInput);
        },
        updateInjection(_, args: IInjectionMutateArguments): Promise<EntityMutateOutput<Injection>> {
            return Injection.updateWith(args.injectionInput);
        },
        deleteInjection(_, args: IIdOnlyArguments): Promise<DeleteOutput> {
            return Injection.deleteFor(args.id);
        },

        createSample(_, args: ISampleMutateArguments): Promise<EntityMutateOutput<Sample>> {
            return Sample.createWith(args.sample);
        },
        updateSample(_, args: ISampleMutateArguments): Promise<EntityMutateOutput<Sample>> {
            return Sample.updateWith(args.sample);
        },
        deleteSample(_, args: IIdOnlyArguments): Promise<DeleteOutput> {
            return Sample.deleteFor(args.id);
        },

        createNeuron(_, args: INeuronMutateArguments,): Promise<EntityMutateOutput<Neuron>> {
            return Neuron.createWith(args.neuron);
        },
        updateNeuron(_, args: INeuronMutateArguments): Promise<EntityMutateOutput<Neuron>> {
            return Neuron.updateWith(args.neuron);
        },
        deleteNeuron(_, args: IIdOnlyArguments): Promise<DeleteOutput> {
            return Neuron.deleteFor(args.id);
        },

        async uploadSwc(_, args: ITracingUploadArguments, context: User): Promise<IUploadOutput> {
            const output = await Tracing.createApprovedTracing(context.id, args.neuronId, args.structureId, args.duration, args.length, args.file);

            return output;
        },
        updateTracing(_, args: IUpdateTracingArguments, context: User): Promise<IUpdateTracingOutput> {
            return Tracing.updateTracing(args.tracing);
        },
        deleteTracing(_, args: IIdOnlyArguments, context: User): Promise<DeleteOutput> {
            return Tracing.deleteTracing(args.id);
        },

        setSystemMessage(_, args: any): boolean {
            systemMessage = args.message;

            return true;
        },
        clearSystemMessage(): boolean {
            systemMessage = "";

            return true;
        },

        async uploadAnnotationMetadata(_, args: IAnnotationUploadArguments): Promise<IUpdateAnnotationOutput> {
            return Neuron.updateAnnotationMetadata(args.neuronId, args.file);
        },

        async applyTransform(_, args: IIdOnlyArguments): Promise<TransformResult> {
            return Tracing.applyTransform(args.id);
        },

        async requestReconstruction(_, args: IIdOnlyArguments, context: User): Promise<Neuron> {
            return Neuron.requestAnnotation(args.id, context);
        },
        async requestReconstructionReview(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            // TODO verify User matches annotator or that User permissions are high e.g., admin
            return Reconstruction.markAnnotationForReview(args.id);
        },
        async requestReconstructionHold(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            // TODO verify User matches annotator or that User permissions are high e.g., admin
            return Reconstruction.markAnnotationOnHold(args.id);
        },
        async approveReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            // TODO verify permissions on User
            return Reconstruction.approveAnnotation(args.id, context.id);
        },
        async declineReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            // TODO verify permissions on User
            return Reconstruction.declineAnnotation(args.id, context.id);
        },
        async cancelReconstruction(_, args: IIdOnlyArguments, context: User): Promise<IErrorOutput> {
            return Reconstruction.cancelAnnotation(args.id);
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
        async annotator(reconstruction: Reconstruction): Promise<User> {
            return reconstruction.getAnnotator();
        },
        async proofreader(reconstruction: Reconstruction): Promise<User> {
            return reconstruction.getProofreader();
        },
        async neuron(reconstruction: Reconstruction): Promise<Neuron> {
            return reconstruction.getNeuron();
        },
        async axon(reconstruction: Reconstruction): Promise<Tracing> {
            return reconstruction.getAxon();
        },
        async dendrite(reconstruction: Reconstruction): Promise<Tracing> {
            return reconstruction.getDendrite();
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
};

let systemMessage: String = "";

interface ISystemSettings {
    apiVersion: string;
    apiRelease: number;
    neuronCount: number;
}

async function getSystemSettings(searchScope: SearchScope): Promise<ISystemSettings> {
    const neuronCount = await Neuron.neuronCount(searchScope);

    return {
        apiVersion: ServiceOptions.version,
        apiRelease: ServiceOptions.release,
        neuronCount
    }
}