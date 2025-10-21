import {gql} from "graphql-tag";

export const inputTypeDefinitions = gql`
    input UserQueryInput {
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
        includeImported: Boolean
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

    input GenotypeQueryInput {
        ids: [String!]
        sampleIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input InjectionVirusQueryInput {
        ids: [String!]
        injectionIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input FluorophoreQueryInput {
        ids: [String!]
        injectionIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input InjectionQueryInput {
        ids: [String!]
        injectionVirusIds: [String!]
        fluorophoreIds: [String!]
        brainAreaIds: [String!]
        sampleIds: [String!]
        neuronIds: [String!]
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input SampleQueryInput {
        ids: [String!]
        mouseStrainIds: [String!]
        injectionIds: [String!]
        reconstructionStatus: Int
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input SomaPropertyInput {
        brightnessOperator: Int
        brightness: Float
        volumeOperator: Int
        volume: Float
    }

    input NeuronQueryInput {
        ids: [String!]
        injectionIds: [String!]
        sampleIds: [String!]
        brainStructureIds: [String!]
        tag: String
        reconstructionStatus: Int
        somaProperties: SomaPropertyInput
        sortField: String
        sortOrder: String
        offset: Int
        limit: Int
    }

    input MouseStrainInput {
        id: String
        name: String
    }

    input InjectionVirusInput {
        id: String
        name: String
    }

    input FluorophoreInput {
        id: String
        name: String
    }

    input InjectionInput {
        id: String
        brainAreaId: String
        injectionVirusId: String
        injectionVirusName: String
        fluorophoreId: String
        fluorophoreName: String
        sampleId: String
    }

    input SampleInput {
        id: String
        idNumber: Int
        animalId: String
        tag: String
        comment: String
        sampleDate: Date
        tomography: String
        mouseStrainId: String
        mouseStrainName: String
        collectionId: String
        neuronIds: [String]
    }

    input NeuronInput {
        id: String
        idNumber: Int
        idString: String
        tag: String
        keywords: String
        x: Float
        y: Float
        z: Float
        doi: String
        consensus: Int
        brainStructureId: String
        sampleId: String
    }

    input CollectionInput {
        id: String
        name: String
        description: String
        reference: String
    }

    input TracingInput {
        id: String!
        annotator: String
        neuronId: String
        tracingStructureId: String
    }

    input ImportSomasOptions {
        sampleId: String
        tag: String
        shouldLookupSoma: Boolean
        noEmit: Boolean
    }

    input TracingPageInput {
        offset: Int
        limit: Int
        neuronIds: [String!]
        tracingStructureId: String
    }

    input ReconstructionPageInput {
        offset: Int
        limit: Int
        userOnly: Boolean
        sampleIds: [String!]
        """Maps directory to Reconstruction status property."""
        filters: [Int!]
    }

    input ReviewPageInput {
        offset: Int
        limit: Int
        sampleIds: [String!]
        status: [Int!]
    }

    input PeerReviewPageInput {
        offset: Int
        limit: Int
        sampleIds: [String!]
        tag: String
    }

    input PublishedReconstructionPageInput {
        offset: Int
        limit: Int
        sampleIds: [String!]
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
        scope: Int
        predicates: [Predicate!]
    }

    """
    Input for chunked reconstruction data query
    """
    input ReconstructionDataChunkedInput {
        """Which parts of the reconstruction to fetch"""
        parts: [ReconstructionDataPart!]
        """Offset for axon nodes pagination"""
        axonOffset: Int
        """Limit for axon nodes pagination"""
        axonLimit: Int
        """Offset for dendrite nodes pagination"""
        dendriteOffset: Int
        """Limit for dendrite nodes pagination"""
        dendriteLimit: Int
    }
`;
