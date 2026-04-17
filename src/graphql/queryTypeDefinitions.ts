import {gql} from "graphql-tag";

export const queryTypeDefinitions = gql`
    type ReconstructionsResponse {
        total: Int!
        offset: Int!
        reconstructions: [Reconstruction!]!
    }
    
    type AtlasReconstructionsResponse {
        total: Int!
        offset: Int!
        reconstructions: [AtlasReconstruction!]!
    }

    type QueryUsers {
        totalCount: Int!
        items: [User!]!
    }

    type QuerySpecimens {
        totalCount: Int!
        items: [Specimen!]!
    }

    type QueryNeurons {
        totalCount: Int!
        offset: Int!
        items: [Neuron!]!
    }

    type EntityCount {
        id: String
        count: Int
    }

    type SearchOutput {
        nonce: String
        queryTime: Int
        totalCount: Int
        neurons: [Neuron]
        error: SearchError
    }

    type SearchError {
        message: String
        code: String
        name: String
    }

    type NearestNodeOutput {
        reconstructionId: String!
        location: [Float!]!
        node: AtlasNode
        error: String
    }

    type DominantStructure {
        atlasStructureId: String!
    }

    type StructureNodeCountEntry {
        atlasStructureId: String!
        nodeCount: Int!
        pathCount: Int!
        branchCount: Int!
        endCount: Int!
        nodePercentage: Float!
    }

    type StructureLengthEntry {
        atlasStructureId: String!
        totalLengthMicrometer: Float!
        axonLengthMicrometer: Float!
        dendriteLengthMicrometer: Float!
        totalLengthPercentage: Float!
        axonLengthPercentage: Float!
        dendriteLengthPercentage: Float!
    }

    type DetailedMetricsEntry {
        atlasStructureId: String!
        neuronStructureId: String!
        nodeCount: Int!
        pathCount: Int!
        branchCount: Int!
        endCount: Int!
        totalLengthMicrometer: Float!
        axonLengthMicrometer: Float!
        dendriteLengthMicrometer: Float!
        nodePercentage: Float!
        totalLengthPercentage: Float!
        axonLengthPercentage: Float!
        dendriteLengthPercentage: Float!
    }

    type NodeCountMetrics {
        totalNodeCount: Int!
        totalPathCount: Int!
        totalBranchCount: Int!
        totalEndCount: Int!
        byStructure: [StructureNodeCountEntry!]!
        dominantNodeStructures: [DominantStructure!]!
        dominantAxonNodeStructures: [DominantStructure!]!
        dominantDendriteNodeStructures: [DominantStructure!]!
    }

    type LengthMetrics {
        totalLengthMicrometer: Float!
        totalAxonLengthMicrometer: Float!
        totalDendriteLengthMicrometer: Float!
        byStructure: [StructureLengthEntry!]!
        dominantLengthStructures: [DominantStructure!]!
        dominantAxonLengthStructures: [DominantStructure!]!
        dominantDendriteLengthStructures: [DominantStructure!]!
    }

    type ReconstructionMetrics {
        reconstructionId: String!
        nodeCounts: NodeCountMetrics!
        lengths: LengthMetrics!
        detailedEntries: [DetailedMetricsEntry!]!
    }
`;
