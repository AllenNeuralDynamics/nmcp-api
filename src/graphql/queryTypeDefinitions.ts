import {gql} from "graphql-tag";

export const queryTypeDefinitions = gql`
    type ReconstructionPage {
        offset: Int
        limit: Int
        totalCount: Int
        reconstructions: [Reconstruction!]!
    }

    type QueryUsers {
        totalCount: Int!
        items: [User!]!
    }

    type QueryBrainAreas {
        totalCount: Int!
        items: [AtlasStructure!]!
    }

    type QuerySamples {
        totalCount: Int!
        items: [Sample!]!
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

    type EntityCountOutput {
        counts: [EntityCount]
        error: String
    }

    type PublishedReconstructionPage {
        totalCount: Int!
        offset: Int!
        limit: Int!
        sampleIds: [String!]!
        reconstructions: [Reconstruction!]!
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
        node: TracingNode
        error: String
    }

    type QualityCheckOutput {
        id: String!
        qualityCheckStatus: Int
        qualityCheck: QualityCheck
        qualityCheckAt: Date
        error: Error
    }
`;
