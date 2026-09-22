import {expect, test, vi, describe, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {Transaction} = require("sequelize");
const {User, UserPermissions} = require("../src/models/user");
const {Neuron} = require("../src/models/neuron");
const {AtlasReconstruction} = require("../src/models/atlasReconstruction");
const {AtlasReconstructionStatus} = require("../src/models/atlasReconstructionStatus");
const {PrecomputedStatus} = require("../src/models/precomputed");
const {PhaseOutcome} = require("../src/util/phaseFailure");
const {EventLogItem, EventLogItemKind} = require("../src/models/eventLogItem");
const {DataCiteService, DataCiteServiceStatus} = require("../src/data-access/doi/dataCiteService");
const {UnauthorizedError} = require("../src/graphql/secureResolvers");

// A sentinel rather than a real Transaction: every assertion about scoping is that this exact value reaches the call.
const transaction = {sentinel: "t"} as any;

const canonicalDoi = "10.x/canonical";
const reconstructionDoi = "10.x/reconstruction";

const hasVersion = (doi: string) =>
    ({relatedIdentifierType: "DOI", relationType: "HasVersion", relatedIdentifier: doi, resourceTypeGeneral: "Dataset"});

function success(doi: string | null = null) {
    return {doi: doi, serviceStatus: DataCiteServiceStatus.Success, serviceError: null, response: null};
}

const unavailable = {doi: null, serviceStatus: DataCiteServiceStatus.Unavailable, serviceError: "connect refused", response: null};
const rejected = {doi: null, serviceStatus: DataCiteServiceStatus.Error, serviceError: "422", response: null};

const relatedSuccess = (relatedIdentifiers: any[]) =>
    ({serviceStatus: DataCiteServiceStatus.Success, serviceError: null, relatedIdentifiers: relatedIdentifiers});

const relatedUnavailable = {serviceStatus: DataCiteServiceStatus.Unavailable, serviceError: "connect refused", relatedIdentifiers: []};
const relatedRejected = {serviceStatus: DataCiteServiceStatus.Error, serviceError: "404", relatedIdentifiers: []};

function userWith(permissions: number, id: string = "user-1") {
    const user = Object.create(User.prototype);
    user.id = id;
    user.permissions = permissions;
    return user;
}

const systemUser = userWith(UserPermissions.InternalSystem, "system-1");

function updateMock(instance: any) {
    return vi.fn().mockImplementation(async (update: any) => {
        Object.assign(instance, update);
        return instance;
    });
}

function prototypeStub(model: any, properties: object = {}) {
    const instance = Object.create(model.prototype);
    Object.assign(instance, {id: "instance-1"}, properties);
    instance.update = updateMock(instance);
    return instance;
}

/**
 * The callback form of transaction(), shared by every model the phase opens one on.  commitFailsOn makes the Nth
 * transaction reject *after* its body has run and its writes have landed on the stub instances - the undetermined
 * state Sequelize describes when a commit is not acknowledged, which the phase must not try to compensate for.
 */
function stubTransactions(commitFailsOn: number = 0) {
    let index = 0;

    const transactionFn = vi.fn().mockImplementation(async (callback: any) => {
        index++;

        const result = await callback(transaction);

        if (index === commitFailsOn) {
            throw new Error("could not commit");
        }

        return result;
    });

    for (const model of [AtlasReconstruction, Neuron]) {
        Object.defineProperty(model, "sequelize", {value: {transaction: transactionFn}, configurable: true, writable: true});
    }

    return transactionFn;
}

type FixtureOptions = {
    canonicalDoi?: string;
    doi?: string;
    status?: number;
    commitFailsOn?: number;
    neuron?: any;
    // The three contributors the reconstruction DOI credits: the proofreader hangs off the child, the other two off the
    // parent.  Absent means the stage was skipped, which is the default every other test here runs with.
    proofreader?: any;
    peerReviewer?: any;
    teamReviewer?: any;
};

// Only what the contributor loop reads.  isSystemUser is explicit because the omission is the rule being tested.
function contributor(name: string, isSystemUser: boolean = false) {
    return {DisplayName: name, affiliation: "An Institute", isSystemUser: isSystemUser};
}

function fixture(options: FixtureOptions = {}) {
    const transactionFn = stubTransactions(options.commitFailsOn ?? 0);

    // What DataCite hands back for each create.  Mutable so a test can show a retry registering a fresh identifier
    // rather than the one an earlier pass failed to record.
    const reserved = {canonical: canonicalDoi, reconstruction: reconstructionDoi};

    vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

    const precomputedEvent = vi.spyOn(EventLogItem, "findOne").mockResolvedValue({createdAt: new Date("2026-03-01")} as any);

    const neuron = options.neuron ?? prototypeStub(Neuron, {
        id: "neuron-1",
        label: "N1",
        specimenId: "specimen-1",
        canonicalDoi: options.canonicalDoi ?? null,
        Specimen: {label: "S1", Collection: {name: "Test Collection"}}
    });

    // Both T1 and T3 lock the neuron row; the locked instance, not an eager-loaded copy, is what decides whether to
    // mint the canonical.
    const lockNeuron = vi.spyOn(Neuron, "findByPk").mockResolvedValue(neuron);

    const parent = {
        id: "reconstruction-1",
        neuronId: "neuron-1",
        reviewerId: options.peerReviewer ? "peer-reviewer-1" : null,
        teamReviewerId: options.teamReviewer ? "team-reviewer-1" : null,
        Reviewer: options.peerReviewer ?? null,
        TeamReviewer: options.teamReviewer ?? null,
        Neuron: neuron,
        Annotator: {DisplayName: "Ann Otator", isSystemUser: false},
        onAtlasReconstructionStatusChanged: vi.fn().mockResolvedValue(undefined)
    };

    const child = prototypeStub(AtlasReconstruction, {
        id: "atlas-1",
        reconstructionId: "reconstruction-1",
        reviewerId: options.proofreader ? "proofreader-1" : null,
        Reviewer: options.proofreader ?? null,
        doi: options.doi ?? null,
        status: options.status ?? AtlasReconstructionStatus.PendingDoiAssignment,
        Reconstruction: parent,
        getReconstruction: vi.fn().mockResolvedValue(parent)
    });

    // Keyed on the payload rather than call order, so a test can run the phase more than once against one set of
    // spies without the queued outcomes running out of step.
    const createDoi = vi.spyOn(DataCiteService, "createDoi").mockImplementation((async (request: any) =>
        success(isCanonicalPayload(request) ? reserved.canonical : reserved.reconstruction)) as any);

    return {
        child: child,
        neuron: neuron,
        parent: parent,
        reserved: reserved,
        lockNeuron: lockNeuron,
        // The static, not the instance method: claim and release are compare-and-sets written through it, and the
        // unavailable paths now hand the claim back before returning.
        staticUpdate: vi.spyOn(AtlasReconstruction, "update").mockResolvedValue([1] as any),
        precomputedEvent: precomputedEvent,
        transactionFn: transactionFn,
        createDoi: createDoi,
        getRelatedIdentifiers: vi.spyOn(DataCiteService, "getRelatedIdentifiers").mockResolvedValue(relatedSuccess([])),
        updateDoi: vi.spyOn(DataCiteService, "updateDoi").mockResolvedValue(success(canonicalDoi))
    };
}

// The canonical is the payload describing the neuron itself; the reconstruction's carries a different subject.
const isCanonicalPayload = (request: any) => request.data.attributes.subjects[0].subject === "Neuron";

const createdAttributes = (createDoi: any, call: number) => createDoi.mock.calls[call][0].data.attributes;

afterEach(() => {
    vi.restoreAllMocks();
    delete (AtlasReconstruction as any).sequelize;
    delete (Neuron as any).sequelize;
});

describe("assignDois registration", () => {
    test("registers both DOIs findable in one create each, and advances the child", async () => {
        const stubs = fixture();

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.createDoi).toHaveBeenCalledTimes(2);
        expect(createdAttributes(stubs.createDoi, 0).event).toBe("publish");
        expect(createdAttributes(stubs.createDoi, 1).event).toBe("publish");

        expect(stubs.neuron.canonicalDoi).toBe(canonicalDoi);
        expect(stubs.child.doi).toBe(reconstructionDoi);

        expect(DataCiteService.promoteDoi).toBeUndefined();
        expect(stubs.updateDoi).toHaveBeenCalledWith(canonicalDoi, [hasVersion(reconstructionDoi)]);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.ReadyToPublish);
        expect(stubs.parent.onAtlasReconstructionStatusChanged)
            .toHaveBeenCalledWith(systemUser, AtlasReconstructionStatus.ReadyToPublish, transaction);
    });

    test("the reconstruction payload describes this reconstruction and points at the canonical", async () => {
        const stubs = fixture();

        await stubs.child.assignDois(systemUser);

        const attributes = createdAttributes(stubs.createDoi, 1);

        expect(attributes.creators).toEqual([{name: "Ann Otator"}]);
        expect(attributes.titles).toEqual([{title: "Neuron N1 in the Test Collection collection"}]);
        expect(attributes.alternateIdentifiers).toEqual([{alternateIdentifier: "N1", alternateIdentifierType: "Neuron Label"}]);
        expect(attributes.relatedIdentifiers).toEqual([
            {relatedIdentifierType: "DOI", relationType: "IsVersionOf", relatedIdentifier: canonicalDoi, resourceTypeGeneral: "Dataset"}
        ]);

        // The parent reconstruction id, not the child's.
        expect(attributes.url).toContain("neuron/neuron-1/reconstruction-1");
    });

    test("the publication year comes from the child's precomputed completion, not the current year", async () => {
        const stubs = fixture();

        await stubs.child.assignDois(systemUser);

        expect(createdAttributes(stubs.createDoi, 0).publicationYear).toBe(2026);
        expect(createdAttributes(stubs.createDoi, 1).publicationYear).toBe(2026);

        const query = stubs.precomputedEvent.mock.calls[0][0] as any;

        expect(query.where.targetId).toBe("atlas-1");
        expect(query.where.kind).toBe(EventLogItemKind.AtlasReconstructionPrecomputedComplete);
        expect(query.order).toEqual([["createdAt", "DESC"]]);
    });

    test("a canonical that already exists is reused rather than re-minted", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi});
        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.createDoi).toHaveBeenCalledTimes(1);
        expect(createdAttributes(stubs.createDoi, 0).relatedIdentifiers[0].relatedIdentifier).toBe(canonicalDoi);
    });

    // A MouseLight import writes a foreign DOI onto the row.  The phase does not own that record, so it must issue no
    // request against it at all - the only PUT is the cross-reference, against the canonical.
    test("a reconstruction DOI that already exists is neither re-minted nor written to", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi, doi: reconstructionDoi});

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.createDoi).not.toHaveBeenCalled();
        expect(stubs.getRelatedIdentifiers).toHaveBeenCalledWith(canonicalDoi);

        expect(stubs.updateDoi).toHaveBeenCalledTimes(1);
        expect(stubs.updateDoi.mock.calls[0][0]).toBe(canonicalDoi);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.ReadyToPublish);
    });

    test("an existing cross-reference is not duplicated, and the write carries nothing but the list", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi, doi: reconstructionDoi});

        const existing = [hasVersion("10.x/sibling"), hasVersion(reconstructionDoi)];

        stubs.getRelatedIdentifiers.mockResolvedValue(relatedSuccess(existing));

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.updateDoi).toHaveBeenCalledWith(canonicalDoi, existing);
        expect(stubs.updateDoi.mock.calls[0]).toHaveLength(2);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.ReadyToPublish);
    });

    test("a child outside the DOI assignment statuses writes nothing and calls no DataCite method", async () => {
        const stubs = fixture({status: AtlasReconstructionStatus.ReadyToPublish});

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.createDoi).not.toHaveBeenCalled();
        expect(stubs.updateDoi).not.toHaveBeenCalled();
        expect(stubs.child.update).not.toHaveBeenCalled();
    });
});

/**
 * The contributor list on the reconstruction DOI, which nothing asserted for any reviewer before team review made it
 * three roles.  The loop skips nulls and system users, so a skipped stage contributes nothing.
 */
describe("assignDois contributors", () => {
    const contributorsOf = (createDoi: any) => createdAttributes(createDoi, 1).contributors;

    test("credits a non-system team reviewer exactly once, with the affiliation carried through", async () => {
        const stubs = fixture({teamReviewer: contributor("Tia Member")});

        await stubs.child.assignDois(systemUser);

        expect(contributorsOf(stubs.createDoi))
            .toEqual([{name: "Tia Member", affiliation: "An Institute", contributorType: "Other"}]);
    });

    test("omits a system team reviewer, as it does the other two", async () => {
        const stubs = fixture({teamReviewer: contributor("System Automation", true)});

        await stubs.child.assignDois(systemUser);

        expect(contributorsOf(stubs.createDoi)).toEqual([]);
    });

    test("adds nothing for a reconstruction that skipped team review", async () => {
        const stubs = fixture({peerReviewer: contributor("Pat Reviewer")});

        await stubs.child.assignDois(systemUser);

        expect(contributorsOf(stubs.createDoi))
            .toEqual([{name: "Pat Reviewer", affiliation: "An Institute", contributorType: "Other"}]);
    });

    // Proofreader, peer reviewer, team reviewer - the order the loop iterates.
    test("credits all three when all three are present", async () => {
        const stubs = fixture({
            proofreader: contributor("Prue Freader"),
            peerReviewer: contributor("Pat Reviewer"),
            teamReviewer: contributor("Tia Member")
        });

        await stubs.child.assignDois(systemUser);

        expect(contributorsOf(stubs.createDoi).map((entry: any) => entry.name))
            .toEqual(["Prue Freader", "Pat Reviewer", "Tia Member"]);
    });

    // assignDois falls back to a lazy load per item for any association the batch query leaves out.
    test("the pending batch eager-loads every contributor the payload reads", async () => {
        const findAll = vi.spyOn(AtlasReconstruction, "findAll").mockResolvedValue([]);

        await AtlasReconstruction.getPendingDoiAssignment(10);

        const include = (findAll.mock.calls[0][0] as any).include;
        const parent = include.find((entry: any) => entry.model !== User);

        expect(include.filter((entry: any) => entry.model === User).map((entry: any) => entry.as)).toEqual(["Reviewer"]);
        expect(parent.include.filter((entry: any) => entry.model === User).map((entry: any) => entry.as))
            .toEqual(["Annotator", "Reviewer", "TeamReviewer"]);
    });
});

describe("assignDois locking", () => {
    test("locks the neuron row for the canonical ensure and again for the cross-reference", async () => {
        const stubs = fixture();

        await stubs.child.assignDois(systemUser);

        expect(stubs.lockNeuron).toHaveBeenCalledTimes(2);

        for (const call of stubs.lockNeuron.mock.calls) {
            expect(call[0]).toBe("neuron-1");
            expect(call[1]).toEqual({transaction: transaction, lock: Transaction.LOCK.UPDATE});
        }
    });

    test("the second lock is taken before the read and released only after the write", async () => {
        const stubs = fixture();

        await stubs.child.assignDois(systemUser);

        const [, crossReferenceLock] = stubs.lockNeuron.mock.invocationCallOrder;

        expect(crossReferenceLock).toBeLessThan(stubs.getRelatedIdentifiers.mock.invocationCallOrder[0]);
        expect(stubs.getRelatedIdentifiers.mock.invocationCallOrder[0]).toBeLessThan(stubs.updateDoi.mock.invocationCallOrder[0]);
    });

    test("the canonical is committed before the reconstruction create begins", async () => {
        const stubs = fixture();

        await stubs.child.assignDois(systemUser);

        // The T1 callback returns - and so its commit runs - before createDoi is called a second time.
        expect(stubs.neuron.update.mock.invocationCallOrder[0]).toBeLessThan(stubs.createDoi.mock.invocationCallOrder[1]);
    });

    // Two siblings of one neuron each read the canonical's list, append their own entry and write the whole array
    // back.  This is the case that loses an entry if the read and the write are not one critical section.
    test("two siblings both land in the canonical's list", async () => {
        const shared = {relatedIdentifiers: [hasVersion("10.x/earlier")]};

        const first = fixture({canonicalDoi: canonicalDoi, doi: "10.x/first"});

        first.getRelatedIdentifiers.mockImplementation(async () => relatedSuccess(shared.relatedIdentifiers.slice()));
        first.updateDoi.mockImplementation((async (_doi: any, list: any[]) => {
            shared.relatedIdentifiers = list;
            return success(canonicalDoi);
        }) as any);

        expect(await first.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        const second = fixture({canonicalDoi: canonicalDoi, doi: "10.x/second"});

        second.getRelatedIdentifiers.mockImplementation(async () => relatedSuccess(shared.relatedIdentifiers.slice()));
        second.updateDoi.mockImplementation((async (_doi: any, list: any[]) => {
            shared.relatedIdentifiers = list;
            return success(canonicalDoi);
        }) as any);

        expect(await second.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(shared.relatedIdentifiers).toEqual([
            hasVersion("10.x/earlier"),
            hasVersion("10.x/first"),
            hasVersion("10.x/second")
        ]);
    });
});

describe("assignDois service outcomes", () => {
    test("an unavailable canonical create leaves the child pending with nothing written", async () => {
        const stubs = fixture();
        stubs.createDoi.mockResolvedValue(unavailable);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.ServiceUnavailable);

        expect(stubs.neuron.canonicalDoi).toBeNull();
        expect(stubs.child.doi).toBeNull();
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);
    });

    // The canonical committed in T1 must survive: re-minting it on the retry is the duplicate this work removes.
    test("an unavailable reconstruction create keeps the canonical already committed", async () => {
        const stubs = fixture();
        stubs.createDoi
            .mockResolvedValueOnce(success(canonicalDoi))
            .mockResolvedValueOnce(unavailable);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.ServiceUnavailable);

        expect(stubs.neuron.canonicalDoi).toBe(canonicalDoi);
        expect(stubs.child.doi).toBeNull();
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);
        expect(stubs.updateDoi).not.toHaveBeenCalled();
    });

    test("a rejected canonical create fails the child and lets the batch continue", async () => {
        const stubs = fixture();
        stubs.createDoi.mockResolvedValue(rejected);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);
        expect(stubs.neuron.canonicalDoi).toBeNull();
    });

    test("a rejected reconstruction create fails the child but keeps the canonical", async () => {
        const stubs = fixture();
        stubs.createDoi
            .mockResolvedValueOnce(success(canonicalDoi))
            .mockResolvedValueOnce(rejected);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);
        expect(stubs.neuron.canonicalDoi).toBe(canonicalDoi);
    });

    // The regression this work fixes: writing after a failed read replaces the canonical's whole list with the single
    // new entry, dropping every earlier reconstruction's HasVersion.
    test("a failed cross-reference read never writes", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi, doi: reconstructionDoi});
        stubs.getRelatedIdentifiers.mockResolvedValue(relatedUnavailable);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.ServiceUnavailable);

        expect(stubs.updateDoi).not.toHaveBeenCalled();
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);
    });

    test("a rejected cross-reference read fails the child without writing", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi, doi: reconstructionDoi});
        stubs.getRelatedIdentifiers.mockResolvedValue(relatedRejected);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.updateDoi).not.toHaveBeenCalled();
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);
    });

    test("an unavailable cross-reference write leaves the child pending", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi, doi: reconstructionDoi});
        stubs.updateDoi.mockResolvedValue(unavailable);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.ServiceUnavailable);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);
    });

    test("a rejected cross-reference write fails the child", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi, doi: reconstructionDoi});
        stubs.updateDoi.mockResolvedValue(rejected);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);
    });
});

/**
 * The window per-step commits cannot close: a create DataCite accepted whose local record did not land.  That window is
 * accepted rather than closed - the identifier is registered, so what these assert is that the phase deletes nothing
 * and investigates nothing, that a write which definitely rolled back is followed by a fresh create, and that a commit
 * that was rejected but persisted is followed by a retry which reuses what is recorded rather than minting a second.
 *
 * A local write failure no longer escapes the phase: the end-to-end wrap records it as FailedDoiAssignment so the
 * worker cannot be left holding a claim on a row with nothing to explain it.  The retry these tests exercise is
 * therefore requestDoiAssignment's, and its point is unchanged - the next pass resumes from the ensure that failed
 * rather than re-minting what is already recorded.
 */
describe("assignDois failure at a remote/local boundary", () => {
    // Each test runs two passes over one set of rows, so the second starts from the state the first left behind.
    // Only the call history is cleared between them; the stubbed outcomes stay in place.
    const nextPass = () => vi.clearAllMocks();

    test("T1 definitely rolled back: the retry creates a fresh canonical and the orphan is left alone", async () => {
        const stubs = fixture();

        stubs.neuron.update = vi.fn().mockRejectedValue(new Error("write failed"));

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);
        expect(stubs.child.failureReason).toBe("unexpected Error during doi assignment");

        expect(stubs.neuron.canonicalDoi).toBeNull();
        expect(stubs.updateDoi).not.toHaveBeenCalled();

        nextPass();
        stubs.neuron.update = updateMock(stubs.neuron);
        stubs.child.status = AtlasReconstructionStatus.PendingDoiAssignment;
        stubs.reserved.canonical = "10.x/fresh-canonical";

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        // A fresh identifier, recorded - the orphaned one is registered and stays that way, retired by hand.
        expect(stubs.createDoi).toHaveBeenCalledTimes(2);
        expect(stubs.neuron.canonicalDoi).toBe("10.x/fresh-canonical");
        expect(stubs.updateDoi).toHaveBeenCalledWith("10.x/fresh-canonical", [hasVersion(reconstructionDoi)]);
    });

    test("T1 commit rejected but persisted: the retry reuses the recorded canonical rather than minting a second", async () => {
        const stubs = fixture({commitFailsOn: 1});

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);

        // The row kept the write the rejected commit may in fact have persisted.
        expect(stubs.neuron.canonicalDoi).toBe(canonicalDoi);
        expect(stubs.updateDoi).not.toHaveBeenCalled();

        nextPass();
        stubs.child.status = AtlasReconstructionStatus.PendingDoiAssignment;

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        // Only the reconstruction is minted, and the recorded canonical is what the cross-reference is written against.
        expect(stubs.createDoi).toHaveBeenCalledTimes(1);
        expect(stubs.updateDoi).toHaveBeenCalledWith(canonicalDoi, [hasVersion(reconstructionDoi)]);
    });

    test("T2 definitely rolled back: the retry creates a fresh reconstruction DOI", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi});

        // The instance update is what T2 writes the new DOI through, and what recordPhaseFailure would use to record
        // the failure - so the failure write fails too, and the phase throws for the worker to release.
        stubs.child.update = vi.fn().mockRejectedValue(new Error("write failed"));

        await expect(stubs.child.assignDois(systemUser)).rejects.toThrow("write failed");

        expect(stubs.child.doi).toBeNull();
        expect(stubs.updateDoi).not.toHaveBeenCalled();

        nextPass();
        stubs.child.update = updateMock(stubs.child);
        stubs.reserved.reconstruction = "10.x/second-create";

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.createDoi).toHaveBeenCalledTimes(1);
        expect(stubs.child.doi).toBe("10.x/second-create");
        expect(stubs.updateDoi).toHaveBeenCalledWith(canonicalDoi, [hasVersion("10.x/second-create")]);
    });

    test("T2 commit rejected but persisted: the retry reuses the recorded DOI and issues no second create", async () => {
        // The canonical is already in place, so T1 is the lock-and-check and T2 is the second transaction.
        const stubs = fixture({canonicalDoi: canonicalDoi, commitFailsOn: 2});

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);
        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedDoiAssignment);

        expect(stubs.child.doi).toBe(reconstructionDoi);
        expect(stubs.updateDoi).not.toHaveBeenCalled();

        nextPass();
        stubs.child.status = AtlasReconstructionStatus.PendingDoiAssignment;

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        expect(stubs.createDoi).not.toHaveBeenCalled();
        expect(stubs.updateDoi).toHaveBeenCalledWith(canonicalDoi, [hasVersion(reconstructionDoi)]);
    });

    // A create the server accepted but whose response was lost comes back as Unavailable, indistinguishable from one
    // that never landed.  The phase records nothing, so the registered identifier is stranded - nothing points at it,
    // and it is retired by hand from the debug line that logged it.
    test("an ambiguous create strands a registered identifier and the retry creates afresh", async () => {
        const stubs = fixture({canonicalDoi: canonicalDoi});

        stubs.createDoi.mockResolvedValue(unavailable);

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.ServiceUnavailable);

        expect(stubs.child.doi).toBeNull();
        expect(stubs.updateDoi).not.toHaveBeenCalled();

        nextPass();
        stubs.createDoi.mockResolvedValue(success("10.x/fresh-create"));

        expect(await stubs.child.assignDois(systemUser)).toBe(PhaseOutcome.Handled);

        // Only ever the recorded identifier: the stranded one is never cross-referenced, so nothing cites it.
        expect(stubs.child.doi).toBe("10.x/fresh-create");
        expect(stubs.updateDoi).toHaveBeenCalledWith(canonicalDoi, [hasVersion("10.x/fresh-create")]);
    });
});

describe("precomputedChanged hand-off", () => {
    test("a completed precomputed hands the child to the DOI phase", async () => {
        const stubs = fixture({status: AtlasReconstructionStatus.PendingPrecomputed});

        await stubs.child.precomputedChanged(systemUser, PrecomputedStatus.Complete, transaction);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);

        const kinds = (EventLogItem.create as any).mock.calls.map((call: any[]) => call[0].kind);

        expect(kinds).toContain(EventLogItemKind.AtlasReconstructionDoiAssignmentRequest);
        expect(kinds).not.toContain(EventLogItemKind.AtlasReconstructionUpdate);
    });

    test("a failed precomputed still fails the child", async () => {
        const stubs = fixture({status: AtlasReconstructionStatus.PendingPrecomputed});

        await stubs.child.precomputedChanged(systemUser, PrecomputedStatus.FailedToGenerate, transaction);

        expect(stubs.child.status).toBe(AtlasReconstructionStatus.FailedPrecomputed);
    });
});

describe("requestDoiAssignment", () => {
    function requestable(status: number | null) {
        stubTransactions();

        vi.spyOn(EventLogItem, "create").mockResolvedValue({id: "event-1"} as any);

        const child = status === null ? null : prototypeStub(AtlasReconstruction, {
            id: "atlas-1",
            reconstructionId: "reconstruction-1",
            status: status
        });

        return {child: child, findOne: vi.spyOn(AtlasReconstruction, "findOne").mockResolvedValue(child)};
    }

    test("refuses a user without the reconstruction-modify permission", async () => {
        requestable(AtlasReconstructionStatus.FailedDoiAssignment);

        await expect(AtlasReconstruction.requestDoiAssignment(userWith(UserPermissions.AnnotateOne), "reconstruction-1"))
            .rejects.toBeInstanceOf(UnauthorizedError);
    });

    test("refuses when there is no atlas reconstruction", async () => {
        requestable(null);

        await expect(AtlasReconstruction.requestDoiAssignment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toThrow("No atlas reconstruction found for this reconstruction");
    });

    test("resets a failed child and records the request", async () => {
        const stubs = requestable(AtlasReconstructionStatus.FailedDoiAssignment);

        const child = await AtlasReconstruction.requestDoiAssignment(userWith(UserPermissions.PublishReview), "reconstruction-1");

        expect(child.status).toBe(AtlasReconstructionStatus.PendingDoiAssignment);

        expect((EventLogItem.create as any).mock.calls[0][0].kind).toBe(EventLogItemKind.AtlasReconstructionDoiAssignmentRequest);
        expect(stubs.findOne).toHaveBeenCalledWith(expect.objectContaining({lock: Transaction.LOCK.UPDATE, transaction: transaction}));
    });

    // Typed rather than prose: the common case is that the phase completed a moment before the request, and a script
    // caller has to tell that from a real failure.
    test.each([
        ["ReadyToPublish", AtlasReconstructionStatus.ReadyToPublish],
        ["Published", AtlasReconstructionStatus.Published],
        ["PendingDoiAssignment", AtlasReconstructionStatus.PendingDoiAssignment]
    ])("refuses a child at %s with code 1004", async (_name: string, status: number) => {
        const stubs = requestable(status);

        await expect(AtlasReconstruction.requestDoiAssignment(userWith(UserPermissions.PublishReview), "reconstruction-1"))
            .rejects.toMatchObject({
                message: "This reconstruction is not waiting on DOI assignment; its current phase has already moved on.",
                extensions: {code: 1004}
            });

        expect(stubs.child.update).not.toHaveBeenCalled();
    });
});
