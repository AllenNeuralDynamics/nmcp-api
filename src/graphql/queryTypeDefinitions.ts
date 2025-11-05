import {gql} from "graphql-tag";

export const queryTypeDefinitions = gql`
    type ReconstructionsResponse {
        total: Int!
        offset: Int!
        reconstructions: [Reconstruction!]!
    }

    type QueryUsers {
        totalCount: Int!
        items: [User!]!
    }

    type QueryAtlasStructures {
        totalCount: Int!
        items: [AtlasStructure!]!
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

    type EntityCountOutput {
        counts: [EntityCount]
        error: String
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
`;
