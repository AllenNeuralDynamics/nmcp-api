import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Specimen} = require("../src/models/specimen");
const {Neuron} = require("../src/models/neuron");
const {EventLogItem} = require("../src/models/eventLogItem");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t", rollback: vi.fn()} as any;

function userWith(permissions: number) {
    const user = Object.create(User.prototype);
    user.id = "user-1";
    user.permissions = permissions;
    return user;
}

function editor() {
    return userWith(UserPermissions.Edit);
}

function prototypeStub(model: any, properties: object = {}) {
    const instance = Object.create(model.prototype);
    Object.assign(instance, {id: "instance-1"}, properties);
    instance.update = vi.fn().mockImplementation(async (update: any) => Object.assign(instance, update));
    return instance;
}

function stubDelete(liveNeuronCount: number, destroyed: number = 1) {
    Object.defineProperty(Specimen, "sequelize", {
        value: {transaction: vi.fn().mockImplementation(async (callback: any) => callback(transaction))},
        configurable: true,
        writable: true
    });

    const create = vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"});
    const findByPk = vi.spyOn(Specimen, "findByPk").mockResolvedValue(prototypeStub(Specimen, {id: "specimen-1", collectionId: "collection-1"}));
    const count = vi.spyOn(Neuron, "count").mockResolvedValue(liveNeuronCount);
    const destroy = vi.spyOn(Specimen, "destroy").mockResolvedValue(destroyed);

    return {create, findByPk, count, destroy};
}

afterEach(() => {
    vi.restoreAllMocks();
    transaction.rollback.mockClear();
    delete (Specimen as any).sequelize;
});

describe("specimen deletion guard", () => {
    test("live neurons refuse the delete", async () => {
        const stubs = stubDelete(2);

        await expect(Specimen.deleteByPk("specimen-1", editor())).rejects.toThrow(/still has 2 neuron/);

        expect(stubs.destroy).not.toHaveBeenCalled();
        expect(stubs.create).not.toHaveBeenCalled();
    });

    test("the guard counts live neurons in the delete's transaction", async () => {
        const stubs = stubDelete(0);

        await Specimen.deleteByPk("specimen-1", editor());

        expect(stubs.count).toHaveBeenCalledWith({where: {specimenId: "specimen-1"}, transaction});
    });

    test("the delete locks the specimen before counting", async () => {
        const stubs = stubDelete(0);

        await Specimen.deleteByPk("specimen-1", editor());

        const [id, options] = stubs.findByPk.mock.calls[0];

        expect(id).toBe("specimen-1");
        expect(options).toMatchObject({transaction, lock: Transaction.LOCK.UPDATE});
        expect(options).not.toHaveProperty("paranoid");
        expect(stubs.findByPk.mock.invocationCallOrder[0]).toBeLessThan(stubs.count.mock.invocationCallOrder[0]);
    });

    test("a specimen with no live neurons is deleted as before", async () => {
        const stubs = stubDelete(0, 1);

        await expect(Specimen.deleteByPk("specimen-1", editor())).resolves.toBe("specimen-1");

        expect(stubs.create).toHaveBeenCalledTimes(1);
    });

    test("an unknown specimen is refused as today", async () => {
        stubDelete(0, 0);

        await expect(Specimen.deleteByPk("specimen-1", editor())).rejects.toThrow(/could not be removed/);

        expect(transaction.rollback).toHaveBeenCalled();
    });

    test("a user without edit permission is refused before counting", async () => {
        const stubs = stubDelete(0);

        await expect(Specimen.deleteByPk("specimen-1", userWith(UserPermissions.None))).rejects.toBeInstanceOf(UnauthorizedError);

        expect(stubs.count).not.toHaveBeenCalled();
    });
});

describe("findLiveAndLock", () => {
    test("reads with the paranoid default under a share lock", async () => {
        const findByPk = vi.spyOn(Specimen, "findByPk").mockResolvedValue(null);

        await Specimen.findLiveAndLock("specimen-1", transaction);

        expect(findByPk).toHaveBeenCalledWith("specimen-1", {transaction, lock: Transaction.LOCK.SHARE});
    });

    test("passes a stronger lock through", async () => {
        const findByPk = vi.spyOn(Specimen, "findByPk").mockResolvedValue(null);

        await Specimen.findLiveAndLock("specimen-1", transaction, Transaction.LOCK.NO_KEY_UPDATE);

        expect(findByPk).toHaveBeenCalledWith("specimen-1", {transaction, lock: Transaction.LOCK.NO_KEY_UPDATE});
    });
});
