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
        #
        # Open queries that do not require authentication.
        #

        """Provides system information, such as the current service versions and total number of reconstructions."""
        systemSettings: SystemSettings

        """Returns details for the currently authenticated user."""
        user: User

        """Returns supported operators for use in search queries."""
        queryOperators: [QueryOperator!]!

        """Returns the pre-define set of all node structure identifiers (e.g., soma, branch, end, etc)."""
        structureIdentifiers: [StructureIdentifier!]!

        """Returns the pre-defined set of all tracing structures (axon, dendrite)."""
        tracingStructures: [TracingStructure!]!

        """Returns all brain compartments, subject to any input filtering."""
        brainAreas(input: BrainAreaQueryInput): [BrainArea!]!

        """Returns details for a single brain compartment."""
        brainArea(id: String!): BrainArea

        """Returns details for all collections."""
        collections: [Collection!]!

        """Returns all tomography metadata for referencing or loading default or sample-based slices."""
        tomographyMetadata: [TomographyMetadata!]

        """Returns the closest node in the reconstruction graph to the given location."""
        nearestNode(id: String!, location: [Float!]!): NearestNodeOutput

        publishedReconstructions(input: PublishedReconstructionPageInput): PublishedReconstructionPage!

        downloadReconstruction(id: String!, format: ExportFormat): String

        """Returns a set of reconstructions based on the provided search criteria."""
        searchNeurons(context: SearchContext): SearchOutput

        #
        # Secure queries that require user-level authentication.
        #

        users(input: UserQueryInput): QueryUsers

        structureIdentifier(id: String): StructureIdentifier!

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

        candidateNeurons(input: NeuronQueryInput, includeInProgress: Boolean): QueryNeurons

        reconstruction(id: String): Reconstruction
        reconstructions(pageInput: ReconstructionPageInput): ReconstructionPage!
        candidatesForReview: [Neuron!]!
        reviewableReconstructions(input: ReviewPageInput): ReconstructionPage!
        peerReviewableReconstructions(input: PeerReviewPageInput): ReconstructionPage!

        issueCount: Int!

        openIssues: [Issue!]!

        #
        # Internal queries that require system authentication.
        #

        reconstructionData(id: String!): String

        """Returns reconstruction data as a structured JSON object instead of a string"""
        reconstructionDataJSON(id: String!): ReconstructionDataJSON

        """Returns reconstruction data with support for partial fetching and chunking"""
        reconstructionDataChunked(id: String!, input: ReconstructionDataChunkedInput): ReconstructionDataChunked

        neuronReconstructionData(id: String!): String

        pendingPrecomputed: [Precomputed!]!
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

        importSomas(file: Upload!, options: ImportSomasOptions!): ImportSomasOutput!

        createCollection(collection: CollectionInput!): MutatedCollection!
        updateCollection(collection: CollectionInput!): MutatedCollection!
        deleteCollection(id: String!): DeleteOutput!

        updatePrecomputed(id: String!, version: Int!, generatedAt: Date!): Precomputed
        invalidatePrecomputed(ids: [String!]!): [String!]!

        uploadSwc(reconstructionId: String, structureId: String, file: Upload): TracingUploadOutput!
        uploadUnregisteredSwc(reconstructionId: String, structureId: String, file: Upload): UnregisteredTracingUploadOutput!

        requestReconstruction(id: String!): Tracing
        requestReconstructionHold(id: String!): Error
        requestReconstructionPeerReview(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        requestReconstructionReview(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        updateReconstruction(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        approveReconstructionPeerReview(id: String!): Error
        approveReconstruction(id: String!): Error
        declineReconstruction(id: String!): Error
        cancelReconstruction(id: String!): Error
        publishReconstruction(id: String!): Error
        deleteReconstruction(id: String!): Boolean

        unpublish(id: String!): Boolean

        reload: Boolean

        importSmartSheet(id: String!): Boolean

        createIssue(neuronId: String, reconstructionId: String, kind: Int!, description: String!): Issue
        closeIssue(id: String!, reason: String!): Boolean
    }

    schema {
        query: Query
        mutation: Mutation
    }`;
