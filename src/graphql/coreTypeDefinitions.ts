import {gql} from "graphql-tag";

export const coreTypeDefinitions = gql`
    scalar Upload
    scalar Date

    type Error {
        kind: Int
        name: String
        message: String
    }

    type Features {
        enableUpdatedViewer: Boolean
    }

    type SystemSettings {
        apiVersion: String
        neuronCount: Int
        features: Features
    }

    type User {
        id: String!
        authDirectoryId: String
        firstName: String
        lastName: String
        emailAddress:String
        affiliation: String
        permissions: Int
        isAnonymousForComplete: Boolean
        isAnonymousForCandidate: Boolean
        reconstructions: [Reconstruction]
    }

    enum PredicateType {
        ANATOMICAL
        CUSTOM
        ID
    }

    type QueryOperator {
        id: String
        display: String
        operator: String
    }

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
        tomography: String
        mouseStrain: MouseStrain
        injections: [Injection!]!
        collectionId: String
        neurons: [Neuron!]!
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
        sampleX: Float
        sampleY: Float
        sampleZ: Float
        doi: String
        consensus: Int
        metadata: String
        brainStructureId: String
        brainArea: BrainArea
        sample: Sample
        latest: Reconstruction
        reconstructions: [Reconstruction!]
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
        nodeCount: Int
        pathCount: Int
        branchCount: Int
        endCount: Int
        tracingStructure: TracingStructure
        searchTransformAt: Date
        reconstruction: Reconstruction
        soma: TracingNode
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
        structureIdentifierId: String
        structureIdentifier: StructureIdentifier
        structureIdValue: Int
        brainStructureId: String
        brainStructure: BrainArea
        tracing: Tracing
        createdAt: Date
        updatedAt: Date
    }

    type UnregisteredTracing {
        id: String!
        filename: String
        fileComments: String
        nodeCount: Int
        pathCount: Int
        branchCount: Int
        endCount: Int
        tracingStructure: TracingStructure
        createdAt: Date
        updatedAt: Date
    }

    type QualityError {
        testName: String!
        testDescription: String!
        affectedNodes: [Int!]!
    }

    type QualityCheck {
        warnings:[QualityError!]!
        errors: [QualityError!]!
        standardMorphVersion: String!
    }

    type Reconstruction {
        id: String!
        status: Int
        notes: String
        checks: String
        durationHours: Float
        lengthMillimeters: Float
        annotatorId: String
        annotator: User
        proofreaderId: String
        proofreader: User
        peerReviewerId: String
        peerReviewer: User
        neuronId: String
        neuron: Neuron
        axon: Tracing
        dendrite: Tracing
        precomputed: Precomputed
        startedAt: Date
        completedAt: Date
        qualityCheckStatus: Int
        qualityCheckVersion: String
        qualityCheck: QualityCheck
        qualityCheckAt: Date
    }

    type Precomputed {
        id: String!
        skeletonSegmentId: Int
        version: Int
        generatedAt: Date
        reconstructionId: String!
        createdAt: Date
        updatedAt: Date
    }

    type Collection {
        id: String!
        name: String!
        description: String
        reference: String
        createdAt: Date
        updatedAt: Date
    }

    type Issue {
        id: String!
        kind: Int
        status: Int
        description: String
        response: String
        creator: User
        neuron: Neuron
        responder: User
        createdAt: Date
        updatedAt: Date
    }

    enum ExportFormat {
        SWC
        JSON
    }

    """
    The range of valid indices for requesting slices for each plane.  Not required if requesting by actual location.
    """
    type SliceLimits {
        """2-element vector for min/max of range."""
        sagittal: [Float]
        """2-element vector for min/max of range."""
        horizontal: [Float]
        """2-element vector for min/max of range."""
        coronal: [Float]
    }

    """
    Metadata for available image slices for a given sample.  This information is no required for typical slice
    requests where a a location is provided, other than the sample id.
    """
    type TomographyMetadata {
        id: String
        name: String
        origin: [Float]
        pixelSize: [Float]
        threshold: [Float]
        limits: SliceLimits
    }

    """
    Node structure for reconstruction data
    """
    type ReconstructionDataNode {
        sampleNumber: Int!
        structureIdentifier: Int!
        x: Float!
        y: Float!
        z: Float!
        radius: Float!
        parentNumber: Int!
        allenId: Int
    }

    """
    Allen brain area information for reconstruction
    """
    type ReconstructionAllenInfo {
        allenId: Int!
        name: String!
        safeName: String!
        acronym: String!
        graphOrder: Int!
        structurePath: String!
        colorHex: String!
    }

    """
    Annotation space information
    """
    type ReconstructionAnnotationSpace {
        version: Int!
        description: String!
    }

    """
    Soma information for reconstruction
    """
    type ReconstructionSoma {
        x: Float!
        y: Float!
        z: Float!
        allenId: Int
    }

    """
    Label information for reconstruction
    """
    type ReconstructionLabel {
        virus: String!
        fluorophore: String!
    }

    """
    Collection information for sample
    """
    type ReconstructionSampleCollection {
        id: String
        name: String
        description: String
        reference: String
    }

    """
    Sample information for reconstruction
    """
    type ReconstructionSample {
        date: Date
        subject: String
        genotype: String
        collection: ReconstructionSampleCollection
    }

    """
    Individual neuron data within reconstruction
    """
    type ReconstructionNeuronData {
        id: String!
        idString: String!
        DOI: String
        sample: ReconstructionSample!
        label: [ReconstructionLabel!]
        annotationSpace: ReconstructionAnnotationSpace!
        annotator: User
        proofreader: User
        peerReviewer: User
        soma: ReconstructionSoma!
        axonId: String
        axon: [ReconstructionDataNode!]!
        dendriteId: String
        dendrite: [ReconstructionDataNode!]!
        allenInformation: [ReconstructionAllenInfo!]!
    }

    """
    Complete reconstruction data as JSON object
    """
    type ReconstructionDataJSON {
        comment: String!
        neurons: [ReconstructionNeuronData!]!
    }

    """
    Enum for reconstruction data parts
    """
    enum ReconstructionDataPart {
        header
        axon
        dendrite
        allenInformation
    }

    """
    Chunk information for paginated data
    """
    type ReconstructionChunkInfo {
        totalCount: Int!
        offset: Int!
        limit: Int!
        hasMore: Boolean!
    }

    """
    Header information for chunked reconstruction (everything except axon, dendrite, and allenInformation)
    """
    type ReconstructionHeaderData {
        id: String!
        idString: String!
        DOI: String
        sample: ReconstructionSample!
        label: [ReconstructionLabel!]
        annotationSpace: ReconstructionAnnotationSpace!
        annotator: User
        proofreader: User
        peerReviewer: User
        soma: ReconstructionSoma!
        axonId: String
        dendriteId: String
    }

    """
    Chunked reconstruction data response
    """
    type ReconstructionDataChunked {
        comment: String!
        header: ReconstructionHeaderData
        axon: [ReconstructionDataNode!]
        axonChunkInfo: ReconstructionChunkInfo
        dendrite: [ReconstructionDataNode!]
        dendriteChunkInfo: ReconstructionChunkInfo
        allenInformation: [ReconstructionAllenInfo!]
    }
`;
