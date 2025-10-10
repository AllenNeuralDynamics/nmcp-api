import {KDTree, Point} from "../src/util/kdtree";

const emptyTree = new KDTree([]);

let nearest = emptyTree.nearest({x: 0.5, y: 0.5, z: 0.5});
if (nearest.length > 0) {
    console.log("expected empty nearest");
}

const points : Point[] = [
    {x: 0.5, y: 0.5, z: 0.6, id: "A"},
    {x: 0.4, y: 0.2, z: 0.8, id: "B"},
    {x: 0.1, y: 0.7, z: 0.1, id: "C"},
    {x: 0.3, y: 0.7, z: 0.2, id: "D"}
];

const tree = new KDTree(points);

describe("validate nearest neighbor", () => {
    it("checks a location", () => {
        confirmNearestNeighbor(tree, points,  {x: 0.5, y: 0.5, z: 0.5});
    });
    it("checks a location", () => {
        confirmNearestNeighbor(tree, points,  {x: 0.1, y: 0.5, z: 0.5});
    });
    it("checks a location", () => {
        confirmNearestNeighbor(tree, points,  {x: 0.3, y: 0.5, z: 0.1});
    });
});

function confirmNearestNeighbor(tree: KDTree, points: Point[], point: Point) {
    // Brute force to verify implementation.

    let minDistance = Infinity;
    let id = null;

    points.forEach((p) => {
        let distance = 0;

        KDTree.dimensionNames.forEach((name) => {
            distance += (p[name] - point[name]) ** 2;
        })

        if (distance < minDistance) {
            minDistance = distance;
            id = p.id;
        }
    });

    const nearest = tree.nearest(point);

    expect(nearest.length).toBe(1);
    expect(nearest[0].point.id).toBe(id);
}
