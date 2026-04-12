import {gql} from "graphql-tag";
import {PortalAnnotationSpace, PortalNeuron, PortalNode, PortalSpecimen, PortalUser} from "../io/portalFormat";

export const coreTypeDefinitions = gql`
    scalar Upload
    scalar Date

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
        aliases: [String!]
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

    type ReferenceDataset {
        url: String
        segmentationUrl: String
    }

    type Specimen {
        id: String
        label: String
        notes: String
        referenceDate: Date
        somaProperties: SomaFeatures
        tomography: TomographyReference
        referenceDataset: ReferenceDataset
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
        doi: String
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
        current: QualityOutput
        history: [QualityOutput!]
    }

    type QualityControlTest {
        name: String!
        safeName: String
        description: String!
        nodes: [Int!]!
    }

    type QualityControlToolError {
        kind: String
        description: String
        info: String
    }

    type QualityOutput {
        serviceVersion: Int!
        toolVersion: String!
        score: Int!
        passed: [QualityControlTest!]!
        warnings: [QualityControlTest!]!
        errors: [QualityControlTest!]!
        toolError: QualityControlToolError
        when: Date
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

    type ApiKey {
        id: String!
        permissions: Int!
        expiration: Date
        description: String
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

    type PortalNode {
        index: Int!
        structure: Int!
        x: Float!
        y: Float!
        z: Float!
        radius: Float!
        parentIndex: Int!
        lengthToParent: Int
        atlasStructure: Int
    }

    type PortalInjection {
        virus: String!
        fluorophore: String!
    }

    type PortalCollection {
        id: String!
        name: String
        description: String
        reference: String
    }

    type PortalSpecimen {
        id: String!
        label: String
        date: String
        subject: String
        genotype: String
        injections: [PortalInjection!]!
        collection: PortalCollection
    }

    type PortalNeuron {
        id: String!
        label: String
        specimen: PortalSpecimen
    }

    type PortalUser  {
        id: String!
        displayName: String
        affiliation: String
        email: String
    }

    type PortalReconstruction {
        id: String!
        annotationSpace: Int
        neuron: PortalNeuron
        annotator: PortalUser
        peerReviewer: PortalUser
        proofreader: PortalUser
        nodes: [PortalNode!]!
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
        specimen: [VersionHistoryEvent!]!
        trunk: [VersionHistoryEvent!]!
        branches: [VersionHistoryBranch!]!
    }
`;
