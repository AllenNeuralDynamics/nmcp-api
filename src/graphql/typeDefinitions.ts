import {gql} from "graphql-tag";

import {coreTypeDefinitions} from "./coreTypeDefinitions"
import {inputTypeDefinitions} from "./inputTypeDefinitions"
import {queryTypeDefinitions} from "./queryTypeDefinitions";

export const typeDefinitions = gql`
    directive @hidden on FIELD_DEFINITION | OBJECT | INPUT_OBJECT

    ${coreTypeDefinitions}
    ${inputTypeDefinitions}
    ${queryTypeDefinitions}

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

        """Returns the pre-define set of all node structures (e.g., soma, branch, end, etc)."""
        nodeStructures: [NodeStructure!]!

        """Returns the pre-defined set of neuron structures (axon, dendrite)."""
        neuronStructures: [NeuronStructure!]!

        """Returns all atlas structures, subject to any input filtering."""
        atlasStructures(input: AtlasStructureQueryInput): [AtlasStructure!]!

        """Returns details for a single atlas structure."""
        atlasStructure(id: String!): AtlasStructure

        """Returns details for all collections."""
        collections: [Collection!]!

        """Returns details for all genotypes."""
        genotypes: [Genotype!]!

        """Returns details for all fluorophores."""
        fluorophores: [Fluorophore!]!

        """Returns details for all injection viruses."""
        injectionViruses: [InjectionVirus!]!

        """ Returns details for all specimens, subject to any input filtering."""
        specimens(input: SpecimenQueryInput): QuerySpecimens

        """Returns details for a single aneuron."""
        neuron(id: String!): Neuron

        """Returns a filtered list of candidate neurons."""
        candidateNeurons(input: NeuronQueryInput, includeInProgress: Boolean): QueryNeurons

        """Returns a set of reconstructions based on the provided search criteria."""
        searchNeurons(context: SearchContext): SearchOutput

        """Returns the closest node in the reconstruction graph to the given location."""
        nearestNode(id: String!, location: [Float!]!): NearestNodeOutput

        # The following are not used by any of the services themselves at this time.  They are open/public for use by scripts/tools that may want to access
        # the data.
        """Returns all or subset of published reconstruction details"""
        publishedReconstructions(offset: Int, limit: Int): ReconstructionsResponse!

        #
        # Secure queries that require user-level authentication.
        #

        users(input: UserQueryInput): QueryUsers

        nodeStructure(id: String): NodeStructure!

        genotype(id: String!): Genotype

        injections(input: InjectionQueryInput): [Injection!]!
        injection(id: String!): Injection

        specimen(id: String!): Specimen

        neurons(input: NeuronQueryInput): QueryNeurons

        reconstructions(queryArgs: ReconstructionQueryArgs!): ReconstructionsResponse

        issueCount: Int!

        openIssues: [Issue!]!
        
        specimenSpaceReconstructionAsJson(id: String!): PortalReconstructionContainer
        
        """Returns reconstruction data with support for partial fetching and chunking"""
        reconstructionAsJson(id: String!, options: PortalReconstructionInput): PortalReconstructionContainer
        
        #
        # Internal queries that require system authentication.
        #
        pendingPrecomputed: [Precomputed!]!
        specimenSpacePendingPrecomputed: [Precomputed!]!
    }

    type Mutation {
        #
        # Open (unauthenticated) mutations.
        #
        # IF YOU ARE ADDING A MUTATION OTHER THAN THE REQUEST ACCESS MUTATION, CONSIDER WHAT YOU ARE DOING CAREFULLY
        #
        requestAccess(request: AccessRequestInput!): Int!

        #
        # Secure mutations that require user-level authentication.
        #

        createInjection(injectionInput: InjectionInput): Injection!
        updateInjection(injectionInput: InjectionInput): Injection!
        deleteInjection(id: String!): String!

        createSpecimen(specimen: SpecimenInput): Specimen!
        updateSpecimen(specimen: SpecimenInput): Specimen!
        deleteSpecimen(id: String!): String!

        createNeuron(neuron: NeuronInput): Neuron!
        updateNeuron(neuron: NeuronInput): Neuron!
        deleteNeuron(id: String!): String!

        createCollection(collection: CollectionInput!): Collection!
        updateCollection(collection: CollectionInput!): Collection!
        # No delete.  Has implications that are not yet handled.

        updateUserPermissions(id: String!, permissions: Int!): User
        updateUserAnonymity(id: String!, anonymousAnnotation: Boolean!, anonymousPublish: Boolean!): User

        importSomas(file: Upload!, options: ImportSomasOptions!): Int!

        openReconstruction(neuronId: String!): Reconstruction
        pauseReconstruction(reconstructionId: String!): Reconstruction
        resumeReconstruction(reconstructionId: String!): Reconstruction
        requestReview(reconstructionId: String!, targetStatus: Int!, duration: Float, notes: String): Reconstruction
        approveReconstruction(reconstructionId: String!, targetStatus: Int!): Reconstruction
        openReconstructionRevision(reconstructionId: String!, revisionKind: Int!): Reconstruction

        """Requests the reconstruction be queued for publishing.  May not be immediately available as published."""
        publish(reconstructionId: String!, replaceExisting: Boolean): Reconstruction
        publishAll(reconstructionIds: [String!]!): [Reconstruction!]!
        rejectReconstruction(reconstructionId: String!): Reconstruction
        discardReconstruction(reconstructionId: String!): Reconstruction

        updateReconstruction(reconstructionId: String!, duration: Float, notes: String, started: Date, completed: Date): Reconstruction
        uploadJsonData(uploadArgs: ReconstructionUploadArgs!): Reconstruction
        uploadSwcData(uploadArgs: ReconstructionUploadArgs!): Reconstruction

        openIssue(kind: Int!, description: String!, references: [IssueReferenceInput!]!): Issue
        modifyIssue(id: String!, status: Int!): Issue
        closeIssue(id: String!, resolutionKind: Int!, resolution: String!): Issue

        #
        # Internal mutations that require system authentication.
        #

        updatePrecomputed(id: String!, status: Int!, version: Int!, generatedAt: Date!): Precomputed
        updateSpecimenSpacePrecomputed(id: String!, status: Int!, version: Int!, generatedAt: Date!): Precomputed
    }

    schema {
        query: Query
        mutation: Mutation
    }`;
