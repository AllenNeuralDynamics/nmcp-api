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

        """Returns every atlas kind."""
        atlasKinds: [AtlasKind!]!

        """Returns every loaded atlas."""
        atlases: [Atlas!]!

        """Returns the structures of one atlas."""
        atlasStructures(atlasId: String!, input: AtlasStructureQueryInput): [AtlasStructure!]!

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

        """Returns details for a single specimen."""
        specimen(id: String!): Specimen

        """Returns details for a single a neuron."""
        neuron(id: String!): Neuron

        """Returns a filtered list of candidate neurons.  A neuron with an annotation, by any annotator, at any of
        excludedAnnotationStatuses is left out.  Omitted or null, that list is Untraceable, Duplicate and
        Incomplete; an empty list excludes nothing.  It applies in addition to includeInProgress.  Results are ordered by
        specimen label, neuron label, then id.  offset is honored exactly; an offset at or past totalCount returns no
        items."""
        candidateNeurons(input: NeuronQueryInput, includeInProgress: Boolean, excludedAnnotationStatuses: [Int!]): QueryNeurons

        """Returns the atlas soma locations of the candidate neurons candidateNeurons would return for the same
        arguments, one chunk at a time in neuron id order.  Pass the previous chunk's nextCursor as after to continue.
        chunkSize defaults to, and is capped at, 2000.  input.offset and input.limit are ignored.  A walk never returns an
        id twice, and a neuron that stays a candidate throughout is returned exactly once; one whose status changes
        during the walk is reported as of when the walk reaches it, so the ids returned can differ from totalCount."""
        candidateNeuronLocations(input: NeuronQueryInput, includeInProgress: Boolean, excludedAnnotationStatuses: [Int!], after: String, chunkSize: Int): CandidateNeuronLocations!

        """Returns a candidate neuron's zero-based row index in candidateNeurons order (specimen label, neuron label, then
        id) for the same arguments, to pass as input.offset so the returned window starts at that neuron.  Returns null
        when id names no neuron, or one that is not a candidate under these arguments.  input.offset and input.limit are
        ignored."""
        candidateNeuronOffset(id: String!, input: NeuronQueryInput, includeInProgress: Boolean, excludedAnnotationStatuses: [Int!]): Int

        """Returns a set of reconstructions based on the provided search criteria."""
        searchNeurons(context: SearchContext): SearchOutput

        """Returns the closest node in the reconstruction graph to the given location."""
        nearestNode(id: String!, location: [Float!]!): NearestNodeOutput

        """Returns computed morphological metrics for a published reconstruction."""
        reconstructionMetrics(id: String!): ReconstructionMetrics

        neuronVersionHistory(neuronId: String!): NeuronVersionHistory

        # The following are not used by any of the services themselves at this time.  They are open/public for use by scripts/tools that may want to access
        # the data.
        """Returns all or subset of published reconstruction details"""
        publishedReconstructions(offset: Int, limit: Int): AtlasReconstructionsResponse!

        #
        # Secure queries that require user-level authentication.
        #

        users(input: UserQueryInput): QueryUsers

        nodeStructure(id: String): NodeStructure!

        genotype(id: String!): Genotype

        injections(input: InjectionQueryInput): [Injection!]!
        injection(id: String!): Injection

        neurons(input: NeuronQueryInput): QueryNeurons

        annotations(queryArgs: AnnotationQueryArgs!): AnnotationsResponse

        """Returns a specific atlas quality control instance."""
        atlasQualityControl(id: String!): AtlasQualityControl

        issueCount: Int!

        openIssues: [Issue!]!

        """Returns all API keys for the authenticated user."""
        apiKeys: [ApiKey!]!

        """Returns access requests, optionally limited to a set of statuses.  Requires admin permissions."""
        accessRequests(input: AccessRequestQueryInput): QueryAccessRequests

        exportedSpecimenReconstruction(id: String!): PortalReconstruction

        exportedAtlasReconstruction(id: String!): PortalReconstruction

        exportedRawReconstruction(id: String!): PortalReconstruction

        #
        # Internal queries that require system authentication.
        #
        pendingPrecomputed: [Precomputed!]!
        specimenSpacePendingPrecomputed: [Precomputed!]!
        """Addresses of the most recent requests, newest first.  In-memory only; never persisted."""
        recentRequestAddresses: [RecentRequest!]!
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

        createSpecimen(specimen: SpecimenCreateInput): Specimen!
        updateSpecimen(specimen: SpecimenInput): Specimen!
        """Soft-deletes a specimen.  Refused while the specimen has any neuron that is not deleted."""
        deleteSpecimen(id: String!): String!

        createNeuron(neuron: NeuronInput): Neuron!
        updateNeuron(neuron: NeuronInput): Neuron!
        deleteNeuron(id: String!): String!
        updateNeurons(input: NeuronBulkUpdateInput!): [Neuron!]!
        updateNeuronsByQuery(input: NeuronBulkUpdateByQueryInput!): [Neuron!]!

        createCollection(collection: CollectionInput!): Collection!
        updateCollection(collection: CollectionInput!): Collection!
        # No delete.  Has implications that are not yet handled.

        """Sets an ordinary user's permissions.  Errors with code 1006 if the value carries any bit outside the
normal-user set — the internal-access bits belong to the seeded system users and cannot be granted here.  A system
user is a no-op, returning null.  A change that takes any capability away also narrows every API key the user owns, in
the same transaction."""
        updateUserPermissions(id: String!, permissions: Int!): User
        updateUserAnonymity(id: String!, anonymousAnnotation: Boolean!, anonymousPublish: Boolean!): User

        importSomas(file: Upload!, options: ImportSomasOptions!): Int!

        """Opens a new annotation for the neuron.  Errors with code 1002 if the user is limited to a single open annotation and already has one."""
        openAnnotation(neuronId: String!): Annotation
        pauseAnnotation(annotationId: String!): Annotation
        """Returns an annotation at OnHold, Incomplete or Duplicate to InProgress."""
        resumeAnnotation(annotationId: String!): Annotation
        """Holds the annotation as Incomplete.  Admissible from InProgress or Rejected; left only by resumeAnnotation."""
        markAnnotationIncomplete(annotationId: String!): Annotation
        """Holds the annotation as Duplicate.  Admissible from InProgress or Rejected; left only by resumeAnnotation."""
        markAnnotationDuplicate(annotationId: String!): Annotation
        requestReview(annotationId: String!, targetStatus: Int!, duration: Float, notes: String): Annotation
        """Errors with code 1005 when approving publish review before the atlas reconstruction data has been uploaded."""
        approveAnnotation(annotationId: String!, targetStatus: Int!): Annotation
        """Opens a revision of the annotation.  Errors with code 1002 if the user is limited to a single open annotation and already has one."""
        openAnnotationRevision(annotationId: String!, revisionKind: Int!): Annotation

        """Requests the reconstruction be queued for publishing.  May not be immediately available as published.  Errors with
code 1001 if the neuron has a published reconstruction and replaceExisting is not set, or 1003 if a publish is already
in progress for the neuron.

publishAll takes at most 50 reconstructions per call: a longer explicit list is refused outright with code 1007, and
["ALL"] publishes the oldest 50 publishable reconstructions waiting at ReadyToPublish - those whose neuron does not
already hold a publish - the caller repeating until the queue drains.

publishAll returns the reconstructions that did publish and stops at the first refusal, so a short list means a
refusal ended the run and the remainder was never attempted.  An error means the attempt itself failed; the
reconstructions already returned in a successful call are committed regardless.

Error codes in use across these mutations: 1001 an existing published reconstruction, 1002 the single open annotation
limit, 1003 a publish already in progress, 1004 the request does not apply at the reconstruction's current phase, 1005
approval requires the atlas data, 1006 a permissions value outside the normal-user set, 1007 more than 50
reconstructions in one publish call, 1008 the reconstruction's state no longer admits a publish."""
        publish(annotationId: String!, replaceExisting: Boolean): Annotation
        publishAll(annotationIds: [String!]!): [Annotation!]!
        rejectAnnotation(annotationId: String!): Annotation
        discardAnnotation(annotationId: String!): Annotation
        markAnnotationUntraceable(annotationId: String!): Annotation
        requestSpecimenSpaceRegeneration(specimenSpaceReconstructionId: String!): Precomputed
        """Restarts one automatic phase.  Admissible only from that phase's own failed status.  Errors with code 1004
from any other, which for a script caller is the benign case of the phase having completed underneath the request."""
        requestQualityControlReassessment(annotationId: String!): AtlasReconstruction
        requestDoiAssignment(annotationId: String!): AtlasReconstruction
        requestStructureAssignment(annotationId: String!): AtlasReconstruction
        requestPrecomputedRegeneration(annotationId: String!): AtlasReconstruction
        requestSearchIndexing(annotationId: String!): AtlasReconstruction
        """Replays every automatic phase from the beginning.  Admissible from a failed automatic phase or from
ReadyToPublish.  Registered DOIs are kept.  Errors with code 1004 from any other state."""
        resetReconstructionPipeline(annotationId: String!): AtlasReconstruction

        updateAnnotation(annotationId: String!, duration: Float, notes: String, started: Date, completed: Date): Annotation
        uploadSwcData(uploadArgs: ReconstructionUploadArgs!): Annotation
        uploadParquetData(uploadArgs: ReconstructionUploadArgs!): Annotation
        """Uploads a raw reconstruction.  At InProgress or Rejected the annotation's annotator, a peer, team or publish
reviewer, or an admin may upload.  At PeerReview, TeamReview or PublishReview the rule is the specimen-space upload's:
the reviewer holding that status's review bit, or an admin.  Any other caller gets a 401 and any other status gets code
1009, all before the file is read and none recording an attempt.  Past that check every attempt is recorded, and a failure is
recorded before its error is returned.  The current raw reconstruction is replaced only by a complete upload."""
        uploadRawSwcData(uploadArgs: RawReconstructionUploadArgs!): RawReconstructionUpload
        uploadRawParquetData(uploadArgs: RawReconstructionUploadArgs!): RawReconstructionUpload

        createApiKey(key: String!, description: String, durationDays: Int, permissions: Int): ApiKey!
        deleteApiKey(id: String!): Boolean!

        """Sets the status of an access request.  Requires admin permissions."""
        updateAccessRequestStatus(id: String!, status: Int!): AccessRequest

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
