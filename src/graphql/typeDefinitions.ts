import {gql} from "graphql-tag";

import {coreTypeDefinitions} from "./coreTypeDefinitions"
import {inputTypeDefinitions} from "./inputTypeDefinitions"
import {queryTypeDefinitions} from "./queryTypeDefinitions";
import {mutationTypeDefinitions} from "./mutationTypeDefinitions";

export const typeDefinitions = gql`
    ${coreTypeDefinitions}
    ${inputTypeDefinitions}
    ${queryTypeDefinitions}
    ${mutationTypeDefinitions}

    type Query {
        systemSettings: SystemSettings
        
        user: User
        users(input: UserQueryInput): QueryUsers

        brainAreas(input: BrainAreaQueryInput): [BrainArea!]!
        brainArea(id: String!): BrainArea

        structureIdentifiers: [StructureIdentifier!]!
        structureIdentifier(id: String): StructureIdentifier!

        tracingStructures: [TracingStructure!]!

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
        
        collections: [Collection!]!

        queryOperators: [QueryOperator!]!

        """Provides all tomography metadata."""
        tomographyMetadata: [TomographyMetadata!]
        
        candidateNeurons(input: NeuronQueryInput): QueryNeurons

        pendingPrecomputed: [Precomputed!]!
        
        searchNeurons(context: SearchContext): SearchOutput

        reconstructions(pageInput: ReconstructionPageInput): ReconstructionPage!
        candidatesForReview: [Neuron!]!
        reviewableReconstructions: [Reconstruction!]!
        
        reconstructionData(id: String!): String
        neuronReconstructionData(id: String!): String
        
        openIssues: [Issue!]!
    }

    type Mutation {        
        updateUserPermissions(id: String!, permissions: Int!): User
        updateUserAnonymity(id: String!, anonymousCandidate: Boolean!, anonymousComplete: Boolean!): User

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
        
        createCollection(collection: CollectionInput!): MutatedCollection!
        updateCollection(collection: CollectionInput!): MutatedCollection!
        deleteCollection(id: String!): DeleteOutput!

        updatePrecomputed(id: String!, version: Int!, generatedAt: Date!): Precomputed
        invalidatePrecomputed(ids: [String!]!): [String!]!

        uploadSwc(neuronId: String, structureId: String, file: Upload): TracingUploadOutput!

        updateReconstruction(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        requestReconstruction(id: String!): Tracing
        requestReconstructionReview(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        requestReconstructionHold(id: String!): Error
        approveReconstruction(id: String!): Error
        declineReconstruction(id: String!): Error
        cancelReconstruction(id: String!): Error
        completeReconstruction(id: String!): Error

        unpublish(id: String!): Boolean
        
        createIssue(description: String!, neuronId: String, reconstructionId: String): Issue
    }

    schema {
        query: Query
        mutation: Mutation
    }`;
