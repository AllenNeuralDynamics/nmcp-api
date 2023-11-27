import {GraphQLScalarType} from "graphql";
import {Kind} from "graphql/language";

const GraphQLUpload = require('graphql-upload/GraphQLUpload.js');

import {InjectionVirus, InjectionVirusInput, InjectionVirusQueryInput} from "../models/injectionVirus";
import {Injection, InjectionInput, InjectionQueryInput} from "../models/injection";
import {IUpdateAnnotationOutput, Neuron, NeuronInput, NeuronQueryInput} from "../models/neuron";

import {BrainArea, CompartmentMutationData, CompartmentQueryInput} from "../models/brainArea";
import {MouseStrain, MouseStrainInput, MouseStrainQueryInput} from "../models/mouseStrain";
import {Fluorophore, FluorophoreInput, FluorophoreQueryInput} from "../models/fluorophore";
import {SampleInput, Sample, SampleQueryInput} from "../models/sample";
import {SyncHistory} from "../models/syncHistory";
import {DeleteOutput, EntityCount, EntityCountOutput, EntityMutateOutput, EntityQueryOutput, EntityType} from "../models/baseModel";
import {TransformApiClient} from "../external/transformApiService";
import {SwcApiClient} from "../external/swcApiService";
import {StructureIdentifier} from "../models/structureIdentifier";
import {GraphQLServerContext} from "@apollo/server";
import {TracingStructure} from "../models/tracingStructure";
import {ITracingInput, Tracing} from "../models/tracing";

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
    annotator: string;
    neuronId: string;
    structureId: string;
    registrationKind: number;
    file: Promise<IUploadFile>;
}

export interface ITracingPageInput {
    offset: number;
    limit: number;
    neuronIds: string[];
    tracingStructureId: string;
}

interface ITracingsArguments {
    pageInput: ITracingPageInput;
}

export interface ITracingPage {
    offset: number;
    limit: number;
    totalCount: number;
    matchCount: number;
    tracings: Tracing[];
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

export const resolvers = {
    Upload: GraphQLUpload,

    Query: {
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

        samples(_, args: ISampleQueryArguments): Promise<EntityQueryOutput<Sample>> {
            return Sample.getAll(args.input);
        },
        sample(_, args: IIdOnlyArguments): Promise<Sample> {
            return Sample.findByPk(args.id);
        },

        injections(_, args: IInjectionQueryArguments): Promise<Injection[]> {
            return Injection.getAll(args.input);
        },
        injection(_, args: IIdOnlyArguments): Promise<Injection> {
            return Injection.findByPk(args.id);
        },

        neurons(_, args: INeuronQueryArguments): Promise<EntityQueryOutput<Neuron>> {
            return Neuron.getAll(args.input);
        },
        neuron(_, args: IIdOnlyArguments): Promise<Neuron> {
            return Neuron.findByPk(args.id);
        },
        neuronsForSample(_, args: SampleIdArguments, context: GraphQLServerContext): Promise<Neuron[]> {
            return Neuron.getNeurons(args.sampleId);
        },

        neuronCountsForInjections(_, args: ICountsArguments): Promise<EntityCountOutput> {
            return Injection.neuronCountPerInjection(args.ids);
        },
        neuronCountsForSamples(_, args: ICountsArguments): Promise<EntityCountOutput> {
            return Sample.neuronCountsPerSample(args.ids);
        },

        async tracingCountsForNeurons(_, args: ICountsArguments): Promise<EntityCountOutput> {
            const counts: EntityCount[] = await Promise.all(args.ids.map(async (id) => {
                return {
                    id: id,
                    count: await Tracing.getCountForNeuron(id)
                }
            }));

            return {
                entityType: EntityType.Tracing,
                counts: counts,
                error: null
            }
        },

        structureIdentifiers(_, __, context: GraphQLServerContext): Promise<StructureIdentifier[]> {
            return StructureIdentifier.findAll({});
        },
        tracingStructures(_, __, context: GraphQLServerContext): Promise<TracingStructure[]> {
            return TracingStructure.findAll({});
        },

        tracings(_, args: ITracingsArguments, context: GraphQLServerContext): Promise<ITracingPage> {
            return Tracing.getTracings(args.pageInput);
        },
        transformedTracingCounts(_, args: IIdsArguments, context: GraphQLServerContext): IQueryTracingsCountOutput {
            const counts: ITracingsCount[] = [];

            args.ids.map(id => {
                counts.push({
                    tracingId: id,
                    count: 0
                });
            });

            return {counts: counts, error: null};
        },

        systemMessage(): String {
            return systemMessage;
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

        updateTracing(_, args: IUpdateTracingArguments, context: GraphQLServerContext): Promise<IUpdateTracingOutput> {
            return Tracing.updateTracing(args.tracing);
        },
        async uploadSwc(_, args: ITracingUploadArguments, context: GraphQLServerContext): Promise<IUploadOutput> {
            return Tracing.receiveSwcUpload(args.annotator, args.neuronId, args.structureId, args.registrationKind, args.file);
        },

        setSystemMessage(_, args: any): boolean {
            systemMessage = args.message;

            return true;
        },
        clearSystemMessage(): boolean {
            systemMessage = "";

            return true;
        },

        syncCompartments(): Promise<string> {
            return SyncHistory.syncCompartments();
        },

        async uploadNeurons(_, args: any): Promise<any> {
            return Neuron.updateWithFile(args.file);
        },

        async uploadAnnotationMetadata(_, args: IAnnotationUploadArguments): Promise<IUpdateAnnotationOutput> {
            return Neuron.updateAnnotationMetadata(args.neuronId, args.file);
        },
    },
    BrainArea: {
        injections(brainArea: BrainArea): Promise<Injection[]> {
            return brainArea.getInjections();
        },
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
        neurons(injection: Injection): Promise<Neuron[]> {
            return injection.getNeurons();
        }
    },
    Sample: {
        mouseStrain(sample: Sample, _, __): Promise<MouseStrain> {
            return sample.getMouseStrain();
        },
        injections(sample: Sample): Promise<Injection[]> {
            return sample.getInjections();
        },
        async neuronCount(sample: Sample): Promise<number> {
            const output = await Sample.neuronCountsPerSample([sample.id]);

            if (output.counts.length === 1) {
                return output.counts[0].count;
            }

            return NaN;
        }
    },
    Neuron: {
        brainArea(neuron: Neuron): Promise<BrainArea> {
            return neuron.getBrainArea();
        },
        injection(neuron: Neuron): Promise<Injection> {
            return neuron.getInjection();
        }
    },
    Tracing: {
        async tracingStructure(tracing, _, context: GraphQLServerContext): Promise<TracingStructure> {
            const result: Tracing = await Tracing.findByPk(tracing.id);
            return result ? result.getTracingStructure() : null;
        },
        neuron(tracing, _, context: GraphQLServerContext): Promise<Neuron> {
            return Neuron.findByPk(tracing.neuronId);
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
    })
};

let systemMessage: String = "";
