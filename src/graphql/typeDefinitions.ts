import {gql} from "graphql-tag";

let typeDefinitions = gql`
    scalar Upload
    scalar Date

    type BrainArea {
        id: String!
        name: String
        structureId: Int
        depth: Int
        parentStructureId: Int
        structureIdPath: String
        safeName: String
        acronym: String
        aliasList: [String]
        atlasId: Int
        graphId: Int
        graphOrder: Int
        hemisphereId: Int
        geometryFile: String
        geometryColor: String
        geometryEnable: Boolean
        injections: [Injection!]
        neurons: [Neuron!]
        createdAt: Date
        updatedAt: Date
    }

    type MouseStrain {
        id: String!
        name: String
        samples: [Sample!]
        createdAt: Date
        updatedAt: Date
    }

    type InjectionVirus {
        id: String!
        name: String
        injections: [Injection!]
        createdAt: Date
        updatedAt: Date
    }

    type Fluorophore  {
        id: String!
        name: String
        injections: [Injection!]
        createdAt: Date
        updatedAt: Date
    }

    type Injection {
        id: String!
        sample: Sample
        brainArea: BrainArea
        injectionVirus: InjectionVirus
        fluorophore: Fluorophore
        neurons: [Neuron!]
        createdAt: Date
        updatedAt: Date
    }

    type Sample {
        id: String
        idNumber: Int
        animalId: String
        tag: String
        comment: String
        sampleDate: Date
        visibility: Int
        mouseStrain: MouseStrain
        injections: [Injection!]!
        neuronCount: Int
        createdAt: Date
        updatedAt: Date
    }

    type Neuron {
        id: String
        idNumber: Int
        idString: String
        tag: String
        keywords: String
        x: Float
        y: Float
        z: Float
        visibility: Int
        doi: String
        consensus: Int
        metadata: String
        brainAreaId: String
        brainArea: BrainArea
        injection: Injection
        createdAt: Date
        updatedAt: Date
    }

    type StructureIdentifier {
        id: String!
        name: String
        value: Int
        mutable: Boolean
        createdAt: Date
        updatedAt: Date
    }

    type TracingStructure {
        id: String!
        name: String
        value: Int
        createdAt: Date
        updatedAt: Date
    }

    type Tracing {
        id: String!
        filename: String
        fileComments: String
        annotator: String
        registration: Int
        nodeCount: Int
        pathCount: Int
        branchCount: Int
        endCount: Int
        tracingStructure: TracingStructure
        neuron: Neuron
        createdAt: Date
        updatedAt: Date
    }

    type TracingNode {
        id: String!
        sampleNumber: Int
        parentNumber: Int
        x: Float
        y: Float
        z: Float
        radius: Float
        lengthToParent: Float
        structureIdentifier: StructureIdentifier
        structureIdValue: Int
        tracing: Tracing
        createdAt: Date
        updatedAt: Date
    }

    type TracingPage {
        offset: Int
        limit: Int
        totalCount: Int
        matchCount: Int
        tracings: [Tracing!]!
    }

    type QueryBrainAreas {
        totalCount: Int!
        items: [BrainArea!]!
    }

    type QuerySamples {
        totalCount: Int!
        items: [Sample!]!
    }

    type QueryNeurons {
        totalCount: Int!
        items: [Neuron!]!
    }

    type EntityCount {
        id: String
        count: Int
    }

    type EntityCountOutput {
        entityType: Int
        counts: [EntityCount]
        error: String
    }

    type MutatedBrainArea {
        source: BrainArea
        error: String
    }

    type MutatedMouseStrain {
        source: MouseStrain
        error: String
    }

    type MutatedInjectionVirus {
        source: InjectionVirus
        error: String
    }

    type MutatedFluorophore {
        source: Fluorophore
        error: String
    }

    type MutatedInjection {
        source: Injection
        error: String
    }

    type MutatedSample {
        source: Sample
        error: String
    }

    type MutatedNeuron {
        source: Neuron
        error: String
    }

    type DeleteOutput {
        id: String
        error: String
    }

    type UploadNeuronsOutput {
        neurons: [Neuron]
        error: String
    }

    type UploadAnnotationMetadataOutput {
        metadata: String
        error: String
    }
    
    type Error {
        message: String
        name: String
    }

    type TracingsForSwcTracingCount {
        tracingId: String
        count: Int
    }
    
    type TracingsForTracingsOutput {
        counts: [TracingsForSwcTracingCount]
        error: Error
    }

    type TracingUploadOutput {
        tracing: Tracing
        error: Error
    }
    type UpdateTracingOutput {
        tracing: Tracing
        error: Error
    }
    
    input BrainAreaQueryInput {
        ids: [String!]
        injectionIds: [String!]
        neuronIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input MouseStrainQueryInput {
        ids: [String!]
        sampleIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input InjectionVirusQueryInput {
        ids: [String!]
        injectionIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input FluorophoreQueryInput {
        ids: [String!]
        injectionIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input InjectionQueryInput {
        ids: [String!]
        injectionVirusIds: [String!]
        fluorophoreIds: [String!]
        brainAreaIds: [String!]
        sampleIds: [String!]
        neuronIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input SampleQueryInput {
        ids: [String!]
        mouseStrainIds: [String!]
        injectionIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input NeuronQueryInput {
        ids: [String!]
        injectionIds: [String!]
        sampleIds: [String!]
        brainAreaIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input BrainAreaInput {
        id: String
        aliasList: [String]
    }

    input MouseStrainInput {
        id: String
        name: String
    }

    input InjectionVirusInput {
        id: String
        name: String
    }

    input FluorophoreInput {
        id: String
        name: String
    }

    input InjectionInput {
        id: String
        brainAreaId: String
        injectionVirusId: String
        injectionVirusName: String
        fluorophoreId: String
        fluorophoreName: String
        sampleId: String
    }

    input SampleInput {
        id: String
        idNumber: Int
        animalId: String
        tag: String
        comment: String
        sampleDate: Date
        visibility: Int
        mouseStrainId: String
        mouseStrainName: String
        injectionIds: [String]
    }

    input NeuronInput {
        id: String
        idNumber: Int
        idString: String
        tag: String
        keywords: String
        x: Float
        y: Float
        z: Float
        visibility: Int
        doi: String
        consensus: Int
        brainAreaId: String
        injectionId: String
    }

    input TracingPageInput {
        offset: Int
        limit: Int
        neuronIds: [String!]
        tracingStructureId: String
    }
    
    input TracingInput {
        id: String!
        annotator: String
        neuronId: String
        tracingStructureId: String
    }
    
    type Query {
        brainAreas(input: BrainAreaQueryInput): [BrainArea!]!
        brainAreaItems(input: BrainAreaQueryInput): QueryBrainAreas!
        brainArea(id: String!): BrainArea

        mouseStrains(input: MouseStrainQueryInput): [MouseStrain!]!
        mouseStrain(id: String!): MouseStrain

        injectionViruses(input: InjectionVirusQueryInput): [InjectionVirus!]!
        injectionVirus(id: String!): InjectionVirus

        fluorophores(input: FluorophoreQueryInput): [Fluorophore!]!
        fluorophore(id: String!): Fluorophore

        injections(input: InjectionQueryInput): [Injection!]!
        injection(id: String!): Injection

        samples(input: SampleQueryInput): QuerySamples
        sample(id: String!): Sample

        neurons(input: NeuronQueryInput): QueryNeurons
        neuron(id: String!): Neuron
        neuronsForSample(sampleId: String): [Neuron!]!

        neuronCountsForInjections(ids: [String!]): EntityCountOutput
        neuronCountsForSamples(ids: [String!]): EntityCountOutput
        tracingCountsForNeurons(ids: [String!]): EntityCountOutput

        structureIdentifiers: [StructureIdentifier!]!
        structureIdentifier(id: String): StructureIdentifier!

        tracingStructures: [TracingStructure!]!

        tracings(pageInput: TracingPageInput): TracingPage!
        transformedTracingCounts(ids: [String!]): TracingsForTracingsOutput

        systemMessage: String
    }

    type Mutation {
        updateBrainArea(brainArea: BrainAreaInput): MutatedBrainArea!
        syncCompartments: String

        createMouseStrain(mouseStrain: MouseStrainInput): MutatedMouseStrain!
        updateMouseStrain(mouseStrain: MouseStrainInput): MutatedMouseStrain!

        createInjectionVirus(injectionVirus: InjectionVirusInput): MutatedInjectionVirus!
        updateInjectionVirus(injectionVirus: InjectionVirusInput): MutatedInjectionVirus!

        createFluorophore(fluorophore: FluorophoreInput): MutatedFluorophore!
        updateFluorophore(fluorophore: FluorophoreInput): MutatedFluorophore!

        createInjection(injectionInput: InjectionInput): MutatedInjection!
        updateInjection(injectionInput: InjectionInput): MutatedInjection!
        deleteInjection(id: String!): DeleteOutput!

        createSample(sample: SampleInput): MutatedSample!
        updateSample(sample: SampleInput): MutatedSample!
        deleteSample(id: String!): DeleteOutput!

        createNeuron(neuron: NeuronInput): MutatedNeuron!
        updateNeuron(neuron: NeuronInput): MutatedNeuron!
        deleteNeuron(id: String!): DeleteOutput!

        setSystemMessage(message: String): Boolean
        clearSystemMessage: Boolean
        
        uploadNeurons(file: Upload!): UploadNeuronsOutput
        uploadAnnotationMetadata(neuronId: String, file: Upload): UploadAnnotationMetadataOutput!

        updateTracing(tracing: TracingInput): UpdateTracingOutput!
        uploadSwc(annotator: String, neuronId: String, structureId: String, registrationKind: Int, file: Upload): TracingUploadOutput!
    }

    schema {
        query: Query
        mutation: Mutation
    }`;

export default typeDefinitions;
