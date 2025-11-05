import {gql} from "graphql-tag";

export const mutationTypeDefinitions = gql`
    type ImportSomasOutput {
        count: Int
        idStrings: [String]
        error: Error
    }
`;
