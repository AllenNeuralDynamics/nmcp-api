import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {Precomputed, PrecomputedStatus} = require("../src/models/precomputed");
const {EventLogItem} = require("../src/models/eventLogItem");

const transaction = {sentinel: "t"} as any;

function internalUser() {
    const user = Object.create(User.prototype);
    user.id = "internal-1";
    user.permissions = UserPermissions.InternalAccess;
    return user;
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (Precomputed as any).sequelize;
});

/**
 * D2, the one real deadlock cycle in the pipeline.  requestPrecomputedRegeneration locks the child and then writes the
 * Precomputed row; updateGeneration used to write the Precomputed row first and only reach the child afterwards through
 * precomputedChanged.  A reviewer asking for a regeneration while the precomputed service posts a late result for the
 * same reconstruction was a genuine 40P01, and neither path classifies that the way the worker phases do.
 */
describe("Precomputed.updateGeneration lock order", () => {
    function stubs() {
        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        Object.defineProperty(Precomputed, "sequelize", {
            value: {transaction: vi.fn().mockImplementation(async (callback: any) => await callback(transaction))},
            configurable: true,
            writable: true
        });

        // One array rather than two independent spies: the assertion is about their sequence, not their arguments.
        const callOrder: string[] = [];

        const precomputed = Object.create(Precomputed.prototype);

        Object.assign(precomputed, {
            id: "precomputed-1",
            // The AtlasReconstruction's id, not the parent Reconstruction's - the same trap QualityControl.claim
            // calls out.
            reconstructionId: "atlas-1",
            status: PrecomputedStatus.Pending
        });

        precomputed.update = vi.fn().mockImplementation(async (update: any) => {
            callOrder.push("update");
            Object.assign(precomputed, update);
            return precomputed;
        });

        precomputed.getReconstruction = vi.fn().mockResolvedValue({
            precomputedChanged: vi.fn().mockResolvedValue(undefined)
        });

        vi.spyOn(Precomputed, "findByPk").mockResolvedValue(precomputed);

        const lockChild = vi.spyOn(AtlasReconstruction, "findByPk").mockImplementation(async () => {
            callOrder.push("lock");
            return null;
        });

        return {precomputed: precomputed, lockChild: lockChild, callOrder: callOrder};
    }

    test("locks the atlas reconstruction before writing the precomputed row", async () => {
        const stub = stubs();

        await Precomputed.updateGeneration(internalUser(), "precomputed-1", PrecomputedStatus.Complete, 2, Date.now());

        expect(stub.callOrder).toEqual(["lock", "update"]);
    });

    test("takes that lock FOR UPDATE on the same transaction, keyed on the child's id", async () => {
        const stub = stubs();

        await Precomputed.updateGeneration(internalUser(), "precomputed-1", PrecomputedStatus.Complete, 2, Date.now());

        expect(stub.lockChild).toHaveBeenCalledWith("atlas-1", {transaction: transaction, lock: Transaction.LOCK.UPDATE});
    });

    test.each([PrecomputedStatus.Complete, PrecomputedStatus.FailedToLoad, PrecomputedStatus.FailedToGenerate])(
        "takes it for a %s result as well, not only a successful one",
        async (status: number) => {
            const stub = stubs();

            await Precomputed.updateGeneration(internalUser(), "precomputed-1", status, 2, Date.now());

            expect(stub.callOrder[0]).toBe("lock");
        });
});
