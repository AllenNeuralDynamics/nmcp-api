import {expect, test, describe} from "vitest";

import * as fs from "fs";
import * as path from "path";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {importMayTransition} = require("../src/tools/importTransitionGuard");
const {
    PausableSourceStatuses,
    ReviewRequestSourceStatuses,
    UntraceableSourceStatuses
} = require("../src/models/reconstruction");
const {ReconstructionStatus} = require("../src/models/reconstructionStatus");

const allStatuses = Object.keys(ReconstructionStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => ReconstructionStatus[key] as number);

describe("importMayTransition", () => {
    test.each(PausableSourceStatuses as number[])("OnHold admits source status %s", (status: number) => {
        expect(importMayTransition(status, ReconstructionStatus.OnHold)).toBe(true);
    });

    test.each(allStatuses.filter(status => !(PausableSourceStatuses as number[]).includes(status)))(
        "OnHold refuses source status %s",
        (status: number) => {
            expect(importMayTransition(status, ReconstructionStatus.OnHold)).toBe(false);
        });

    test.each(UntraceableSourceStatuses as number[])("Untraceable admits source status %s", (status: number) => {
        expect(importMayTransition(status, ReconstructionStatus.Untraceable)).toBe(true);
    });

    test.each(allStatuses.filter(status => !(UntraceableSourceStatuses as number[]).includes(status)))(
        "Untraceable refuses source status %s",
        (status: number) => {
            expect(importMayTransition(status, ReconstructionStatus.Untraceable)).toBe(false);
        });

    // Both review targets park by calling requestReview(PublishReview), so both carry the same exemption: a row a
    // previous run left parked is finished rather than skipped.  Getting this wrong skips rows the model would accept.
    for (const target of [ReconstructionStatus.PublishReview, ReconstructionStatus.Approved]) {
        test.each([...ReviewRequestSourceStatuses, ReconstructionStatus.PublishReview] as number[])(
            `${ReconstructionStatus[target]} admits source status %s`,
            (status: number) => {
                expect(importMayTransition(status, target)).toBe(true);
            });

        test.each(allStatuses.filter(status =>
            !(ReviewRequestSourceStatuses as number[]).includes(status) && status != ReconstructionStatus.PublishReview))(
            `${ReconstructionStatus[target]} refuses source status %s`,
            (status: number) => {
                expect(importMayTransition(status, target)).toBe(false);
            });
    }

    // That arm continues without making a transition, so there is nothing to guard and nothing to skip a row over.
    test.each(allStatuses)("InProgress is not a guarded target, from %s", (status: number) => {
        expect(importMayTransition(status, ReconstructionStatus.InProgress)).toBe(true);
    });
});

// Where the guard sits decides what a refused row keeps: everything between the immutable guard and the targetStatus
// switch either reports the row or writes to it, and the upload after the switch approves it.  Asserted against the
// source because smartSheetImport.ts is a CLI entry point that starts an import on load, so it cannot be required.
describe("the SmartSheet guard runs before anything writes to the row", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "tools", "smartSheetImport.ts"), "utf8");

    const guard = source.indexOf("importMayTransition(reconstruction.status, targetStatus)");

    test.each([
        ["the modified/added report entry", "importReport.reconstructionsModified.set"],
        ["the changed-neuron report entry", "importReport.existingNeuronsWithReconstructionChanges.add"],
        ["the metadata update", "await reconstruction.update(updates)"],
        ["the targetStatus switch", "switch (targetStatus)"],
        ["the atlas upload and approve", "loadAtlasReconstruction(reconstruction"]
    ])("before %s", (_unused: string, marker: string) => {
        expect(guard).toBeGreaterThan(0);
        expect(source.indexOf(marker)).toBeGreaterThan(guard);
    });

    test("and reports the row it skips in its own bucket", () => {
        expect(source).toContain("importReport.reconstructionsSkippedStatus.push");
        expect(source).toContain("Reconstructions not Updated (status no longer admits the change)");
    });
});
