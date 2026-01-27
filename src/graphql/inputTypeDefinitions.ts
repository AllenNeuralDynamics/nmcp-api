import {gql} from "graphql-tag";

export const inputTypeDefinitions = gql`
    input UserQueryInput {
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
        includeImported: Boolean
    }

    input IssueReferenceInput {
        id: String
        kind: Int
        # details: JSON // If needed will bring in graphql-scalars for JSON type and allow arbitrary additional info.
    }

    input AtlasStructureQueryInput {
        ids: [String!]
        injectionIds: [String!]
        neuronIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input InjectionQueryInput {
        specimenIds: [String!]
    }

    input SpecimenQueryInput {
        ids: [String!]
        genotypeIds: [String!]
        injectionIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input SomaPropertyInput {
        limitBrightness: Boolean
        brightnessRange: [Float!]
        limitVolume: Boolean
        volumeRange: [Float!]
    }

    input NeuronQueryInput {
        ids: [String!]
        specimenIds: [String!]
        atlasStructureIds: [String!]
        keywords: [String!]
        somaProperties: SomaPropertyInput
        offset: Int
        limit: Int
    }

    input ReconstructionQueryArgs {
        offset: Int
        limit: Int
        userOnly: Boolean
        status: [Int!]
        specimenIds: [String!]
        keywords:  [String!]
    }

    input InjectionInput {
        id: String
        specimenId: String
        atlasStructureId: String
        injectionVirusName: String
        fluorophoreName: String
    }

    input TomographyOptionsInput {
        range: [Float!]!
        window: [Float!]!
    }

    input TomographyReferenceInput {
        url: String
        options: TomographyOptionsInput
    }

    input SpecimenInput {
        id: String
        label: String
        notes: String
        referenceDate: Date
        genotypeId: String
        genotypeName: String
        tomography: TomographyReferenceInput
        collectionId: String
    }

    input SomaLocationInput {
        x: Float
        y: Float
        z: Float
    }

    input NeuronInput {
        id: String
        label: String
        keywords: [String!]
        specimenSoma: SomaLocationInput
        atlasSoma: SomaLocationInput
        atlasStructureId: String
        specimenId: String
    }

    input CollectionInput {
        id: String
        name: String
        description: String
        reference: String
    }

    input ImportSomasOptions {
        specimenId: String
        keywords: [String!]
        shouldLookupSoma: Boolean
        defaultBrightness: Float
        defaultVolume: Float
    }

    input ReconstructionUploadArgs {
        reconstructionId: String!
        reconstructionSpace: Int!
        file: Upload!
    }

    input InputPosition {
        x: Float
        y: Float
        z: Float
    }

    input Predicate {
        predicateType: PredicateType!
        tracingIdsOrDOIs: [String!]
        tracingIdsOrDOIsExactMatch: Boolean
        brainAreaIds: [String!]
        arbCenter: InputPosition
        arbSize: Float
        tracingStructureIds: [String!]
        nodeStructureIds: [String!]
        operatorId: String
        amount: Float
        invert: Boolean
        composition: Int
    }

    input SearchContext {
        nonce: String
        collectionIds: [String!]
        predicates: [Predicate!]
    }

    input AccessRequestInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
        affiliation: String!
        purpose: String!
    }

    """
    Input for chunked reconstruction data query
    """
    input PortalReconstructionInput {
        """Offset for axon nodes pagination"""
        axonOffset: Int
        """Limit for axon nodes pagination.  <=0 to not include axon.  null or undefined to return all."""
        axonLimit: Int
        """Offset for dendrite nodes pagination"""
        dendriteOffset: Int
        """Limit for dendrite nodes pagination  <=0 to not include dendrite.  null or undefined to return all."""
        dendriteLimit: Int
    }
`;
