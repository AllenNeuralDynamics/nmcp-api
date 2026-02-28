import {gql} from "graphql-tag";

export const coreTypeDefinitions = gql`
    scalar Upload
    scalar Date

    type Error {
        name: String
        message: String
        stack: String
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
        isAnonymousForAnnotation: Boolean
        isAnonymousForPublish: Boolean
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

    type NodeStructure {
        id: String!
        name: String
        swcValue: Int
    }

    type NeuronStructure {
        id: String!
        name: String
    }

    type AtlasStructure {
        id: String!
        name: String
        structureId: Int
        depth: Int
        parentStructureId: Int
        structureIdPath: String
        safeName: String
        acronym: String
        aliasList: [String]
        internalId: Int
        defaultColor: String
        hasGeometry: Boolean
    }

    type Genotype {
        id: String!
        name: String
        createdAt: Date
        updatedAt: Date
    }

    type InjectionVirus {
        id: String!
        name: String
        createdAt: Date
        updatedAt: Date
    }

    type Fluorophore  {
        id: String!
        name: String
        createdAt: Date
        updatedAt: Date
    }

    type Injection {
        id: String!
        specimenId: String!
        specimen: Specimen!
        atlasStructureId: String!
        atlasStructure: AtlasStructure
        injectionVirusId: String!
        injectionVirus: InjectionVirus!
        fluorophoreId: String!
        fluorophore: Fluorophore!
        createdAt: Date
        updatedAt: Date
    }

    type SomaFeatures {
        defaultBrightness: Float
        defaultVolume: Float
    }
    
    type TomographyOptions {
        range: [Float!]!
        window: [Float!]!
    }

    type LinearTransformVector {
        x: Float
        y: Float
        z: Float
    }

    type LinearTransform {
        scale: LinearTransformVector
        translate: LinearTransformVector
    }

    type TomographyReference {
        url: String
        options: TomographyOptions
        linearTransform: LinearTransform
    }

    type Specimen {
        id: String
        label: String
        notes: String
        referenceDate: Date
        somaProperties: SomaFeatures
        tomography: TomographyReference
        genotype: Genotype
        injections: [Injection!]!
        collectionId: String
        collection: Collection
        neurons: [Neuron!]!
        neuronCount: Int
        createdAt: Date
        updatedAt: Date
    }

    type SomaLocation {
        x: Float
        y: Float
        z: Float
    }

    type Neuron {
        id: String
        label: String
        keywords: [String!]
        specimenSoma: SomaLocation
        atlasSoma: SomaLocation
        atlasStructureId: String
        atlasStructure: AtlasStructure
        specimen: Specimen
        published: AtlasReconstruction
        reconstructions: [Reconstruction]
        reconstructionCount: Int
        createdAt: Date
        updatedAt: Date
    }

    type AtlasNode {
        id: String!
        index: Int
        parentIndex: Int
        x: Float
        y: Float
        z: Float
        radius: Float
        lengthToParent: Float
        nodeStructureId: String
        nodeStructure: NodeStructure
        structureIdValue: Int
        atlasStructureId: String
        atlasStructure: AtlasStructure
    }

    type NodeCount {
        total: Int
        soma: Int
        path: Int
        branch: Int
        end: Int
    }

    type NodeCounts {
        axon: NodeCount
        dendrite: NodeCount
    }

    type Reconstruction {
        id: String!
        sourceUrl: String
        sourceComments: String
        status: Int
        notes: String
        durationHours: Float
        specimenLengthMillimeters: Float
        specimenNodeCounts: NodeCounts
        annotatorId: String
        annotator: User
        reviewerId: String
        reviewer: User
        neuronId: String
        neuron: Neuron
        atlasReconstructionId: String
        atlasReconstruction: AtlasReconstruction
        precomputed: Precomputed
        startedAt: Date
        completedAt: Date
        reviewedAt: Date
        approvedAt: Date
        publishedAt: Date
        archivedAt: Date
        createdAt: Date
        updatedAt: Date
    }

    type AtlasReconstruction {
        id: String!
        sourceUrl: String
        sourceComments: String
        status: Int
        lengthMillimeters: Float
        nodeCounts: NodeCounts
        soma: AtlasNode
        reconstruction: Reconstruction
        reconstructionId: String
        qualityControl: QualityControl
        neuron: Neuron
        precomputed: Precomputed
        reviewerId: String
        reviewer: User
        nodeStructureAssignmentAt: Date
        searchIndexedAt: Date
        publishedAt: Date
        archivedAt: Date
        createdAt: Date
        updatedAt: Date
    }

    type QualityControl {
        id: String!
        status: Int
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

    type Precomputed {
        id: String!
        skeletonId: Int
        status: Int
        version: Int
        reconstructionId: String!
        generatedAt: Date
        createdAt: Date
        updatedAt: Date
    }

    type Collection {
        id: String!
        name: String!
        description: String!
        reference: String!
        specimenCount: Int!
        createdAt: Date
        updatedAt: Date
    }

    type IssueReference {
        id: String
        kind: Int
    }

    type Issue {
        id: String!
        issueId: Int!
        kind: Int!
        status: Int!
        description: String!
        resolutionKind: Int!
        resolution: String
        references: [IssueReference!]!
        neuron: Neuron
        authorId: String
        author: User
        responder: User
        createdAt: Date
        updatedAt: Date
    }

    enum ExportFormat {
        SWC
        JSON
    }

    """
    Node structure for reconstruction data
    """
    type PortalReconstructionNode {
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
    Atlas structure information for reconstruction
    """
    type PortalReconstructionAtlasInfo {
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
    type PortalReconstructionAnnotationSpace {
        version: Int!
        description: String!
    }

    """
    Soma information for reconstruction
    """
    type PortalReconstructionSoma {
        x: Float!
        y: Float!
        z: Float!
        allenId: Int
    }

    """
    Label information for reconstruction
    """
    type PortalReconstructionLabel {
        virus: String!
        fluorophore: String!
    }

    """
    Collection information for specimens
    """
    type PortalReconstructionCollection {
        id: String
        name: String
        description: String
        reference: String
    }

    """
    Specimen information for reconstruction
    """
    type PortalReconstructionSpecimen {
        date: String
        subject: String
        genotype: String
        collection: PortalReconstructionCollection
    }

    """
    Chunk information for paginated data
    """
    type PortalReconstructionChunkInfo {
        totalCount: Int!
        offset: Int!
        limit: Int!
        hasMore: Boolean!
    }

    """
    Chunked reconstruction data response
    """
    type PortalReconstruction {
        id: String!
        idString: String!
        DOI: String
        sample: PortalReconstructionSpecimen!
        label: PortalReconstructionLabel
        annotationSpace: PortalReconstructionAnnotationSpace!
        annotator: String
        proofreader: String
        peerReviewer: String
        soma: PortalReconstructionSoma!
        axonId: String
        dendriteId: String
        axon: [PortalReconstructionNode!]
        axonChunkInfo: PortalReconstructionChunkInfo
        dendrite: [PortalReconstructionNode!]
        dendriteChunkInfo: PortalReconstructionChunkInfo
        allenInformation: [PortalReconstructionAtlasInfo!]
    }

    """
    Chunked reconstruction data response
    """
    type PortalReconstructionContainer {
        comment: String!
        neurons: [PortalReconstruction]!
    }

    type VersionHistoryEvent {
        id: String!
        kind: Int!
        name: String!
        details: String
        userId: String
        user: User
        createdAt: Date!
    }

    type VersionHistoryBranch {
        reconstructionId: String!
        status: Int!
        startedAt: Date
        events: [VersionHistoryEvent!]!
    }

    type NeuronVersionHistory {
        neuronId: String!
        trunk: [VersionHistoryEvent!]!
        branches: [VersionHistoryBranch!]!
    }
`;
