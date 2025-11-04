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

        """Returns the pre-defined set of all reconstruction elements (axon, dendrite)."""
        tracingStructures: [TracingStructure!]!

        """Returns all brain structures, subject to any input filtering."""
        atlasStructures(input: AtlasStructureQueryInput): [AtlasStructure!]!

        """Returns details for a single brain compartment."""
        atlasStructure(id: String!): AtlasStructure

        """Returns details for all collections."""
        collections: [Collection!]!

        """Returns a set of reconstructions based on the provided search criteria."""
        searchNeurons(context: SearchContext): SearchOutput

        """Returns the closest node in the reconstruction graph to the given location."""
        nearestNode(id: String!, location: [Float!]!): NearestNodeOutput

        # The following are not used by any of the services themselves at this time.  They are open/public for use by scripts/tools that may want to access
        # the data.

        publishedReconstructions(input: PublishedReconstructionPageInput): PublishedReconstructionPage!

        #
        # Secure queries that require user-level authentication.
        #

        users(input: UserQueryInput): QueryUsers

        structureIdentifier(id: String): StructureIdentifier!

        genotypes(input: GenotypeQueryInput): [Genotype!]!
        genotype(id: String!): Genotype

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

        unregisteredReconstructions(neuronId: String!): [UnregisteredReconstruction!]!

        reconstructions(pageInput: ReconstructionPageInput): ReconstructionPage!
        reconstruction(id: String): Reconstruction

        candidateNeurons(input: NeuronQueryInput, includeInProgress: Boolean): QueryNeurons

        reviewableReconstructions(input: ReviewPageInput): ReconstructionPage!
        peerReviewableReconstructions(input: PeerReviewPageInput): ReconstructionPage!

        qualityCheck(id: String): QualityCheck

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
        #
        # There are no open (unauthenticated) mutations.
        #

        #
        # Secure mutations that require user-level authentication.
        #

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

        updateUserPermissions(id: String!, permissions: Int!): User
        updateUserAnonymity(id: String!, anonymousCandidate: Boolean!, anonymousComplete: Boolean!): User

        importSomas(file: Upload!, options: ImportSomasOptions!): ImportSomasOutput!

        uploadReconstructionData(reconstructionId: String, structureId: String, file: Upload): ReconstructionUploadOutput!
        uploadUnregisteredJsonData(neuronId: String!, file: Upload!, reconstructionId: String): UnregisteredReconstructionUploadOutput!
        uploadUnregisteredSwcData(neuronId: String!, axonFile: Upload!, dendriteFile: Upload!, reconstructionId: String): UnregisteredReconstructionUploadOutput!

        requestReconstruction(id: String!): Tracing
        requestReconstructionHold(id: String!): Error
        requestReconstructionPeerReview(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        requestReconstructionReview(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        updateReconstruction(id: String!, duration: Float!, length: Float!, notes: String!, checks: String!): Error
        approveReconstructionPeerReview(id: String!): Error
        approveReconstruction(id: String!): Error
        declineReconstruction(id: String!): Error
        cancelReconstruction(id: String!): Error
        """Requests the reconstruction be queued for publishing.  May not be immediately available as published."""
        publishReconstruction(id: String!): Error
        deleteReconstruction(id: String!): Boolean

        unpublish(id: String!): Boolean

        requestQualityCheck(id: String!): QualityCheckOutput

        createIssue(neuronId: String, reconstructionId: String, kind: Int!, description: String!): Issue
        closeIssue(id: String!, reason: String!): Boolean

        #
        # Internal mutations that require system authentication.
        #

        updatePrecomputed(id: String!, version: Int!, generatedAt: Date!): Precomputed

        invalidatePrecomputed(ids: [String!]!): [String!]!
    }

    schema {
        query: Query
        mutation: Mutation
    }`;
