import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Op} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {
    Reconstruction,
    PublishAllLimit,
    PublishRefusalError,
    PublishedCandidateBlockingStatuses
} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

const transaction = {sentinel: "t"} as any;

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

const publisher = userWith(UserPermissions.PublishReview);

function stubTransactions() {
    const transactionFn = vi.fn().mockImplementation(async (callback: any) => callback(transaction));

    Object.defineProperty(Reconstruction, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});

    return transactionFn;
}

/**
 * Each stub publishes by moving itself to Publishing, which is what publishWithTransaction does on the happy path.
 * failOn names the ids that throw instead, so the stop-and-return behaviour can be exercised without the locking and
 * DOI assertions publish-sibling-guard.test.ts already covers.  The error matters as much as the id: a refusal ends
 * the run quietly, anything else propagates, so failWith is what separates the two cases.
 */
function reconstructions(count: number, failOn: string[] = [], failWith: () => Error = () => new PublishRefusalError("not publishable", 1008)) {
    return Array.from({length: count}, (_unused, index) => {
        const reconstruction = Object.create(Reconstruction.prototype);

        reconstruction.id = `reconstruction-${index}`;
        reconstruction.status = ReconstructionStatus.ReadyToPublish;

        reconstruction.publishWithTransaction = vi.fn().mockImplementation(async () => {
            if (failOn.includes(reconstruction.id)) {
                throw failWith();
            }

            reconstruction.status = ReconstructionStatus.Publishing;

            return reconstruction;
        });

        return reconstruction;
    });
}

const ids = (count: number) => Array.from({length: count}, (_unused, index) => `reconstruction-${index}`);

afterEach(() => {
    vi.restoreAllMocks();
    delete (Reconstruction as any).sequelize;
});

describe("publishAll batch cap", () => {
    test("the cap is 50", () => {
        expect(PublishAllLimit).toBe(50);
    });

    test("refuses an explicit list of 51 with code 1007, without reading anything", async () => {
        stubTransactions();

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await expect(Reconstruction.publishAll(publisher, ids(51))).rejects.toMatchObject({
            message: "At most 50 reconstructions can be published in one request.",
            extensions: {code: 1007}
        });

        expect(findAll).not.toHaveBeenCalled();
    });

    test("accepts an explicit list of exactly 50", async () => {
        stubTransactions();

        const batch = reconstructions(PublishAllLimit);

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(batch);

        const published = await Reconstruction.publishAll(publisher, ids(PublishAllLimit));

        expect(published).toHaveLength(PublishAllLimit);
        expect(batch.every((reconstruction: any) => reconstruction.status === ReconstructionStatus.Publishing)).toBe(true);
    });

    test("the explicit-id branch selects exactly the ids asked for", async () => {
        stubTransactions();

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue(reconstructions(2));

        await Reconstruction.publishAll(publisher, ids(2));

        const options = findAll.mock.calls[0][0] as any;

        expect(options.where.id[Op.in]).toEqual(ids(2));
        expect(options.limit).toBeUndefined();
    });

    // Both order keys are asserted deliberately: createdAt is written from JavaScript at millisecond resolution, so
    // rows created in one import tie, and dropping the id tie-break would let a tied row move into and out of the
    // batch between calls without any test noticing.
    test("ALL is bounded at 50 and ordered by createdAt then id", async () => {
        stubTransactions();

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await Reconstruction.publishAll(publisher, ["ALL"]);

        const options = findAll.mock.calls[0][0] as any;

        expect(options.where.status).toBe(ReconstructionStatus.ReadyToPublish);
        expect(options.limit).toBe(50);
        expect(options.order).toEqual([["createdAt", "ASC"], ["id", "ASC"]]);
    });

    // Without this the drain does not terminate: a reconstruction whose neuron already holds a publish is refused on
    // every call and keeps the head of the oldest-first batch.  Bound off the same constant the refusal queries with.
    test("ALL excludes reconstructions whose neuron already holds a publish", async () => {
        stubTransactions();

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await Reconstruction.publishAll(publisher, ["ALL"]);

        const options = findAll.mock.calls[0][0] as any;
        const clause = options.where[Op.and][0].val as string;

        expect(clause).toContain("NOT EXISTS");
        expect(clause).toContain(`sibling."neuronId"`);
        expect(clause).toContain(`sibling."deletedAt" IS NULL`);
        expect(clause).toContain("ANY(ARRAY[:publishBlockingStatuses])");
        expect(options.replacements.publishBlockingStatuses).toEqual(PublishedCandidateBlockingStatuses);
    });

    // A silent omission would hide a refusal the caller asked about by name.
    test("the explicit-id branch carries no sibling filter", async () => {
        stubTransactions();

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await Reconstruction.publishAll(publisher, ids(2));

        const options = findAll.mock.calls[0][0] as any;

        expect(options.where[Op.and]).toBeUndefined();
        expect(options.replacements).toBeUndefined();
    });

    test("refuses an unauthorized caller before the length check", async () => {
        stubTransactions();

        const findAll = vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        await expect(Reconstruction.publishAll(userWith(UserPermissions.AnnotateOne), ids(51)))
            .rejects.toBeInstanceOf(UnauthorizedError);

        expect(findAll).not.toHaveBeenCalled();
    });
});

// The cap bounds how many reconstructions are attempted, not what happens to them: a refusal ends the run and the
// reconstructions that did publish come back, while anything that is not a refusal propagates.
describe("publishAll per-item failures", () => {
    test("returns what committed and stops at the first refusal", async () => {
        stubTransactions();

        const batch = reconstructions(3, ["reconstruction-1"]);

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(batch);

        expect(await Reconstruction.publishAll(publisher, ids(3))).toEqual([batch[0]]);

        expect(batch[0].status).toBe(ReconstructionStatus.Publishing);
        expect(batch[2].status).toBe(ReconstructionStatus.ReadyToPublish);
        expect(batch[2].publishWithTransaction).not.toHaveBeenCalled();
    });

    // A lock timeout, a failed commit or a defect is not a refusal, and reporting one as a short list would invite the
    // caller to retry into an outage indefinitely.
    test("propagates an error that is not a refusal", async () => {
        stubTransactions();

        const batch = reconstructions(3, ["reconstruction-1"], () => new Error("connection terminated unexpectedly"));

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(batch);

        await expect(Reconstruction.publishAll(publisher, ids(3))).rejects.toThrow("connection terminated unexpectedly");

        expect(batch[2].publishWithTransaction).not.toHaveBeenCalled();
    });

    // The discriminator is the type, never the text: a bare Error wearing a refusal's exact message is still a failure.
    test("classifies on the type rather than the message", async () => {
        stubTransactions();

        const batch = reconstructions(2, ["reconstruction-1"], () => new Error("This neuron has an existing published reconstruction."));

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(batch);

        await expect(Reconstruction.publishAll(publisher, ids(2)))
            .rejects.toThrow("This neuron has an existing published reconstruction.");
    });

    test("resolves to an empty list when the selection is empty", async () => {
        stubTransactions();

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue([]);

        expect(await Reconstruction.publishAll(publisher, ["ALL"])).toEqual([]);
    });

    test("resolves to an empty list when the head of the batch is refused", async () => {
        stubTransactions();

        const batch = reconstructions(3, ["reconstruction-0"]);

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(batch);

        expect(await Reconstruction.publishAll(publisher, ["ALL"])).toEqual([]);
    });

    test("each item publishes in its own transaction", async () => {
        const transactionFn = stubTransactions();

        vi.spyOn(Reconstruction, "findAll").mockResolvedValue(reconstructions(3));

        await Reconstruction.publishAll(publisher, ids(3));

        expect(transactionFn).toHaveBeenCalledTimes(3);
    });
});
