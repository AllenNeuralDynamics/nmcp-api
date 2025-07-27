import {gql} from "graphql-tag";

export const mutationTypeDefinitions = gql`
    type MutatedBrainArea {
        source: BrainArea
        error: String
    }

    type MutatedMouseStrain {
        source: MouseStrain
        error: String
    }

    type MutatedInjectionVirus {
        source: InjectionVirus
        error: String
    }

    type MutatedFluorophore {
        source: Fluorophore
        error: String
    }

    type MutatedInjection {
        source: Injection
        error: String
    }

    type MutatedSample {
        source: Sample
        error: String
    }

    type MutatedNeuron {
        source: Neuron
        error: String
    }

    type MutatedCollection {
        source: Collection
        error: String
    }

    type DeleteOutput {
        id: String
        error: String
    }

    type UploadNeuronsOutput {
        neurons: [Neuron]
        error: String
    }

    type UploadAnnotationMetadataOutput {
        metadata: String
        error: String
    }

    type TracingsForSwcTracingCount {
        tracingId: String
        count: Int
    }

    type TracingsForTracingsOutput {
        counts: [TracingsForSwcTracingCount]
        error: Error
    }

    type TracingUploadOutput {
        tracings: [Tracing]
        error: Error
    }

    type ImportSomasOutput {
        count: Int
        idStrings: [String]
        error: Error
    }
    
    type UpdateTracingOutput {
        tracing: Tracing
        error: Error
    }

    type TransformResult {
        tracing: Tracing
        error: String
    }
`;
