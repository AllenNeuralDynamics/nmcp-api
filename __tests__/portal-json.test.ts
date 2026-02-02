import {describe, expect, test} from "vitest";

import {mapSpecimenNodes} from "../src/io/portalJson";
import {SpecimenNode} from "../src/models/specimenNode";
import {NodeStructures} from "../src/models/nodeStructure";

function makeNode(index: number, parentIndex: number, x = 0, y = 0, z = 0): SpecimenNode {
    return {index, parentIndex, x, y, z, radius: 1, lengthToParent: 0} as unknown as SpecimenNode;
}

describe("mapSpecimenNodes", () => {
    test("renumbers sequential indices starting from 1", () => {
        const nodes = [makeNode(3, -1), makeNode(4, 3), makeNode(5, 4)];
        const result = mapSpecimenNodes(nodes, NodeStructures.axon);

        expect(result.map(n => n.sampleNumber)).toEqual([1, 2, 3]);
        expect(result.map(n => n.parentNumber)).toEqual([-1, 1, 2]);
    });

    test("sorts unsorted input by original index", () => {
        const nodes = [makeNode(10, 5), makeNode(5, -1), makeNode(7, 5)];
        const result = mapSpecimenNodes(nodes, NodeStructures.axon);

        expect(result.map(n => n.sampleNumber)).toEqual([1, 2, 3]);
        expect(result[0].parentNumber).toBe(-1);
        expect(result[1].parentNumber).toBe(1);
        expect(result[2].parentNumber).toBe(1);
    });

    test("handles gaps in index values", () => {
        const nodes = [
            makeNode(1, -1),
            makeNode(5, 1),
            makeNode(6, 5),
            makeNode(7, 6),
            makeNode(12, 7),
            makeNode(13, 12)
        ];

        const result = mapSpecimenNodes(nodes, NodeStructures.axon);

        expect(result.map(n => n.sampleNumber)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(result.map(n => n.parentNumber)).toEqual([-1, 1, 2, 3, 4, 5]);
    });

    test("handles gaps with unsorted input", () => {
        const nodes = [
            makeNode(13, 12),
            makeNode(6, 5),
            makeNode(1, -1),
            makeNode(12, 7),
            makeNode(7, 6),
            makeNode(5, 1)
        ];

        const result = mapSpecimenNodes(nodes, NodeStructures.axon);

        expect(result.map(n => n.sampleNumber)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(result.map(n => n.parentNumber)).toEqual([-1, 1, 2, 3, 4, 5]);
    });

    test("preserves coordinate and radius data", () => {
        const nodes = [makeNode(5, -1, 10.5, 20.3, 30.1)];
        nodes[0].radius = 2.5;
        nodes[0].lengthToParent = 3.7;

        const result = mapSpecimenNodes(nodes, NodeStructures.soma);

        expect(result[0].sampleNumber).toBe(1);
        expect(result[0].x).toBe(10.5);
        expect(result[0].y).toBe(20.3);
        expect(result[0].z).toBe(30.1);
        expect(result[0].radius).toBe(2.5);
        expect(result[0].lengthToParent).toBe(3.7);
    });

    test("uses structureIdentifier override when provided", () => {
        const nodes = [makeNode(1, -1), makeNode(2, 1)];
        const result = mapSpecimenNodes(nodes, NodeStructures.basalDendrite);

        expect(result[0].structureIdentifier).toBe(NodeStructures.basalDendrite);
        expect(result[1].structureIdentifier).toBe(NodeStructures.basalDendrite);
    });

    test("does not mutate the original input array", () => {
        const nodes = [makeNode(10, -1), makeNode(3, -1), makeNode(7, 3)];
        const originalIndices = nodes.map(n => n.index);

        mapSpecimenNodes(nodes, NodeStructures.axon);

        expect(nodes.map(n => n.index)).toEqual(originalIndices);
    });

    test("handles single node", () => {
        const nodes = [makeNode(42, -1)];
        const result = mapSpecimenNodes(nodes, NodeStructures.soma);

        expect(result).toHaveLength(1);
        expect(result[0].sampleNumber).toBe(1);
        expect(result[0].parentNumber).toBe(-1);
    });

    test("handles empty array", () => {
        const result = mapSpecimenNodes([], NodeStructures.axon);
        expect(result).toEqual([]);
    });

    test("leaves parentNumber unchanged when parent index is not in the node set", () => {
        const nodes = [makeNode(5, 2), makeNode(6, 5)];
        const result = mapSpecimenNodes(nodes, NodeStructures.axon);

        expect(result[0].sampleNumber).toBe(1);
        expect(result[0].parentNumber).toBe(2);
        expect(result[1].sampleNumber).toBe(2);
        expect(result[1].parentNumber).toBe(1);
    });
});
