/**
 * Test fixtures for Reconstruction unit tests
 */
import {AxonStructureId, DendriteStructureId} from "../../src/models/tracingStructure";

export class ReconstructionTestFixtures {
    static readonly AXON_STRUCTURE_ID = AxonStructureId;
    static readonly DENDRITE_STRUCTURE_ID = DendriteStructureId;

    static createMockUser(role: string = "user") {
        return {
            id: `${role}-user-id`,
            firstName: `${role}First`,
            lastName: `${role}Last`,
            emailAddress: `${role}@example.com`
        };
    }

    static createMockBrainArea(id: string = "brain-area-1") {
        return {
            id,
            structureId: 100 + parseInt(id.slice(-1)),
            name: `Brain Area ${id}`,
            safeName: `brain_area_${id}`,
            acronym: `BA${id.slice(-1)}`,
            graphOrder: 1,
            structureIdPath: "/997/8/567/",
            geometryColor: "#FF0000"
        };
    }

    static createMockStructureIdentifier(value: number = 1) {
        return {
            id: `struct-id-${value}`,
            value,
            name: `Structure ${value}`
        };
    }

    static createMockTracingNode(options: {
        sampleNumber?: number;
        x?: number;
        y?: number;
        z?: number;
        radius?: number;
        parentNumber?: number;
        structureId?: number;
        brainArea?: any;
    } = {}) {
        const {
            sampleNumber = 1,
            x = 100,
            y = 200,
            z = 300,
            radius = 1.5,
            parentNumber = 0,
            structureId = 1,
            brainArea = null
        } = options;

        return {
            id: `node-${sampleNumber}`,
            sampleNumber,
            x,
            y,
            z,
            radius,
            parentNumber,
            StructureIdentifier: this.createMockStructureIdentifier(structureId),
            BrainArea: brainArea !== null ? (brainArea || this.createMockBrainArea()) : null
        };
    }

    static createMockTracing(options: {
        id?: string;
        structureId?: string;
        nodeCount?: number;
        includesSoma?: boolean;
    } = {}) {
        const {
            id = "tracing-1",
            structureId = this.DENDRITE_STRUCTURE_ID,
            nodeCount = 5,
            includesSoma = true
        } = options;

        const nodes = [];
        
        // Add soma node if requested
        if (includesSoma) {
            nodes.push(this.createMockTracingNode({
                sampleNumber: 1,
                x: 100,
                y: 200,
                z: 300,
                parentNumber: 0
            }));
        }

        // Add additional nodes
        for (let i = includesSoma ? 2 : 2; i <= nodeCount + (includesSoma ? 0 : 1); i++) {
            nodes.push(this.createMockTracingNode({
                sampleNumber: i,
                x: 100 + i * 10,
                y: 200 + i * 5,
                z: 300 + i * 2,
                parentNumber: i - 1
            }));
        }

        return {
            id,
            tracingStructureId: structureId,
            Nodes: nodes
        };
    }

    static createMockInjection() {
        return {
            id: "injection-1",
            injectionVirus: {
                id: "virus-1",
                name: "AAV2/1.FLEX-eGFP"
            },
            fluorophore: {
                id: "fluoro-1",
                name: "eGFP"
            }
        };
    }

    static createMockCollection() {
        return {
            id: "collection-1",
            name: "Test Collection",
            description: "A test collection for unit tests",
            reference: "TEST-REF-001"
        };
    }

    static createMockMouseStrain() {
        return {
            id: "strain-1",
            name: "C57BL/6J"
        };
    }

    static createMockSample() {
        return {
            id: "sample-1",
            sampleDate: new Date("2023-01-01"),
            animalId: "MOUSE-001",
            MouseStrain: this.createMockMouseStrain(),
            Collection: this.createMockCollection(),
            Injections: [this.createMockInjection()]
        };
    }

    static createMockNeuron() {
        return {
            id: "neuron-1",
            idString: "N001",
            doi: "10.1234/test.neuron.001",
            Sample: this.createMockSample()
        };
    }

    static createMockReconstruction(options: {
        id?: string;
        hasAxon?: boolean;
        hasDendrite?: boolean;
        hasSoma?: boolean;
        axonNodeCount?: number;
        dendriteNodeCount?: number;
    } = {}) {
        const {
            id = "reconstruction-1",
            hasAxon = true,
            hasDendrite = true,
            hasSoma = true,
            axonNodeCount = 10,
            dendriteNodeCount = 15
        } = options;

        const tracings = [];

        if (hasDendrite) {
            tracings.push(this.createMockTracing({
                id: "dendrite-tracing",
                structureId: this.DENDRITE_STRUCTURE_ID,
                nodeCount: dendriteNodeCount,
                includesSoma: hasSoma
            }));
        }

        if (hasAxon) {
            tracings.push(this.createMockTracing({
                id: "axon-tracing", 
                structureId: this.AXON_STRUCTURE_ID,
                nodeCount: axonNodeCount,
                includesSoma: false // Soma is typically in dendrite
            }));
        }

        return {
            id,
            Neuron: this.createMockNeuron(),
            Tracings: tracings,
            getAnnotator: jest.fn().mockResolvedValue(this.createMockUser("annotator")),
            getProofreader: jest.fn().mockResolvedValue(this.createMockUser("proofreader")),
            getPeerReviewer: jest.fn().mockResolvedValue(null)
        };
    }

    // Utility methods for specific test scenarios
    static createReconstructionWithoutSoma() {
        return this.createMockReconstruction({
            hasSoma: false
        });
    }

    static createReconstructionWithOnlyAxon() {
        return this.createMockReconstruction({
            hasAxon: true,
            hasDendrite: false,
            hasSoma: false
        });
    }

    static createReconstructionWithMissingData() {
        const reconstruction = this.createMockReconstruction();
        
        // Remove some optional data
        reconstruction.Neuron.Sample.MouseStrain = null;
        reconstruction.Neuron.Sample.Collection = null;
        reconstruction.Neuron.Sample.Injections = [];
        reconstruction.getPeerReviewer = jest.fn().mockResolvedValue(null);
        
        return reconstruction;
    }

    static createLargeReconstruction() {
        return this.createMockReconstruction({
            axonNodeCount: 1000,
            dendriteNodeCount: 800
        });
    }
}
