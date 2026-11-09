import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {User, UserPermissions} = require("../src/models/user");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasNode} = require("../src/models/atlasNode");
const {AtlasQualityControl} = require("../src/models/atlasQualityControl");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

function stub(found: boolean = true) {
    const row = found ? Object.assign(Object.create(AtlasReconstruction.prototype), {id: "atlas-1", annotationId: "annotation-1"}) : null;

    return {
        findOne: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(row),
        event: vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"}),
        destroyQualityControl: vi.spyOn(AtlasQualityControl, "destroy").mockResolvedValue(1),
        destroyNodes: vi.spyOn(AtlasNode, "destroy").mockResolvedValue(3),
        destroyRow: vi.spyOn(AtlasReconstruction, "destroy").mockResolvedValue(1)
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("AtlasReconstruction.discardForAnnotation", () => {
    test("records one discard event parented by the annotation", async () => {
        const stubs = stub();

        await AtlasReconstruction.discardForAnnotation(userWith(UserPermissions.Admin), "annotation-1", transaction);

        expect(stubs.event).toHaveBeenCalledTimes(1);
        expect(stubs.event.mock.calls[0][0]).toMatchObject({
            kind: EventLogItemKind.AtlasReconstructionDiscard,
            targetId: "atlas-1",
            parentId: "annotation-1"
        });
    });

    test("selects the id and the annotation id through the transaction", async () => {
        const stubs = stub();

        await AtlasReconstruction.discardForAnnotation(userWith(UserPermissions.Admin), "annotation-1", transaction);

        expect(stubs.findOne).toHaveBeenCalledWith({
            where: {annotationId: "annotation-1"},
            attributes: ["id", "annotationId"],
            transaction: transaction
        });
    });

    test("removes the quality control, the nodes and the row, in that order, after the event", async () => {
        const stubs = stub();

        await AtlasReconstruction.discardForAnnotation(userWith(UserPermissions.Admin), "annotation-1", transaction);

        expect(stubs.destroyQualityControl).toHaveBeenCalledWith({where: {reconstructionId: "atlas-1"}, transaction: transaction});
        expect(stubs.destroyNodes).toHaveBeenCalledWith({where: {reconstructionId: "atlas-1"}, transaction: transaction});
        expect(stubs.destroyRow).toHaveBeenCalledWith({where: {id: "atlas-1"}, transaction: transaction});

        const order = [stubs.event, stubs.destroyQualityControl, stubs.destroyNodes, stubs.destroyRow]
            .map(spy => spy.mock.invocationCallOrder[0]);

        expect(order).toEqual([...order].sort((first, second) => first - second));
    });

    test("does nothing when the annotation has no atlas row", async () => {
        const stubs = stub(false);

        await AtlasReconstruction.discardForAnnotation(userWith(UserPermissions.Admin), "annotation-1", transaction);

        expect(stubs.event).not.toHaveBeenCalled();
        expect(stubs.destroyQualityControl).not.toHaveBeenCalled();
        expect(stubs.destroyNodes).not.toHaveBeenCalled();
        expect(stubs.destroyRow).not.toHaveBeenCalled();
    });
});
