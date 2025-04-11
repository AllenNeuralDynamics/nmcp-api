export type Point = {
    x: number;
    y: number;
    z: number;
    id?: any;
}

type SplitResult = {
    median: Point;
    left: Point[];
    right: Point[];
}

type Candidate = {
    point: Point;
    tree_distance: number;
}

/*
KDTree implementation specific to 3-D points with known dimensional property names.  Derivative of https://github.com/benmaier/kd-tree-js.
 */
export class KDTree {
    private readonly point: Point;
    private readonly left?: KDTree = null;
    private readonly right?: KDTree = null;

    public static readonly dimensionNames = ["x", "y", "z"];

    private static readonly dimensionCount: number = 3;

    public constructor(points: Point[], dimIndex: number = 0) {
        if (!points) {
            return;
        }

        let split = this.split(points, dimIndex);

        this.point = split.median;

        if (split.left.length > 0)
            this.left = new KDTree(split.left, (dimIndex + 1) % KDTree.dimensionCount);

        if (split.right.length > 0)
            this.right = new KDTree(split.right, (dimIndex + 1) % KDTree.dimensionCount);
    }

    public nearest(point: Point, count: number = 1) {
        if (!this.point) {
            return [];
        }

        return this.nearestSearch(point, count);
    }

    private nearestSearch(point: Point, count: number = 1, closest: Candidate[] = [], dimIndex: number = 0) {
        const hyperplaneDistance = point[KDTree.dimensionNames[dimIndex]] - this.findHyperplane(dimIndex);

        let insideTree: KDTree = null;
        let outsideTree: KDTree = null;

        if (hyperplaneDistance < 0) {
            insideTree = this.left;
            outsideTree = this.right;
        } else {
            insideTree = this.right;
            outsideTree = this.left;
        }

        if (insideTree !== null) {
            closest = insideTree.nearestSearch(point, count, closest, (dimIndex + 1) % KDTree.dimensionCount);
        }

        const distance = this.findDistance(this.point, point);

        if ((closest.length < count) || (distance < closest[count - 1].tree_distance)) {
            closest = this.insertSorted(closest, {
                point: this.point,
                tree_distance: distance
            });
        }

        if (closest.length > count)
            closest = closest.slice(0, count);


        if (outsideTree !== null) {
            let outsideDistance = Infinity;

            if (closest.length > 0)
                outsideDistance = closest[closest.length - 1].tree_distance;

            if ((hyperplaneDistance ** 2 < outsideDistance) || (closest.length < count))
                closest = outsideTree.nearestSearch(point, count, closest, (dimIndex + 1) % KDTree.dimensionCount);
        }

        // get rid of nodes that are too far away
        if (closest.length > count)
            closest = closest.slice(0, count);

        return closest;
    }

    private findHyperplane(dimIndex: number) {
        return this.point[KDTree.dimensionNames[dimIndex]];
    }

    private split(points: Point[], dimIndex: number): SplitResult {
        if (points.length == 1) {
            return {median: points[0], left: [], right: []};
        }

        const propName = KDTree.dimensionNames[dimIndex];
        const sorted = points.sort((a, b) => a[propName] - b[propName]);
        const middle = Math.floor(sorted.length / 2);

        return {median: sorted[middle], left: sorted.slice(0, middle), right: sorted.slice(middle + 1)};
    }

    private findDistance(a: Point, b: Point): number {
        let distance = 0;

        KDTree.dimensionNames.forEach(dimension => {
            distance += (a[dimension] - b[dimension]) ** 2;
        });

        return distance;
    }

    private insertSorted(closest: Candidate[], toInsert: Candidate) {
        let low = 0;
        let high = closest.length;

        while (low < high) {
            let mid = (low + high) >>> 1;

            if (closest[mid].tree_distance < toInsert.tree_distance)
                low = mid + 1;
            else
                high = mid;
        }

        closest.splice(low, 0, toInsert);

        return closest;
    }
}
