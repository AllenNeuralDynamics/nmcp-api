import {expect, test, describe} from "vitest";

import * as fs from "fs";
import * as path from "path";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const {importMayTransition, importLoadsExistingReconstruction, sheetExpectsReconstructionData} = require("../src/tools/importTransitionGuard");
const {
    PausableSourceStatuses,
    ResumableSourceStatuses,
    ReviewRequestSourceStatuses,
    UntraceableSourceStatuses
} = require("../src/models/annotation");
const {AnnotationStatus} = require("../src/models/annotationStatus");

const allStatuses = Object.keys(AnnotationStatus)
    .filter(key => isNaN(Number(key)))
    .map(key => AnnotationStatus[key] as number);

const isHeld = (status: number) => (ResumableSourceStatuses as number[]).includes(status);
const isPausable = (status: number) => (PausableSourceStatuses as number[]).includes(status);

describe("importMayTransition", () => {
    // A hold is applied only to a reconstruction the run created; an existing one keeps its status whatever the sheet
    // says, which is what stops the next run re-holding one the annotator resumed.
    for (const target of ResumableSourceStatuses as number[]) {
        const name = AnnotationStatus[target];

        test.each(PausableSourceStatuses as number[])(`${name} admits source status %s when the run created it`, (status: number) => {
            expect(importMayTransition(status, target, true)).toBe(true);
        });

        test.each(allStatuses)(`${name} refuses source status %s when the reconstruction existed`, (status: number) => {
            expect(importMayTransition(status, target, false)).toBe(false);
        });

        test(`${name} refuses InProgress when createdThisRun is omitted`, () => {
            expect(importMayTransition(AnnotationStatus.InProgress, target)).toBe(false);
        });

        test.each(allStatuses.filter(status => !isPausable(status)))(
            `${name} refuses source status %s even when the run created it`,
            (status: number) => {
                expect(importMayTransition(status, target, true)).toBe(false);
            });
    }

    // A held reconstruction is out of the import's reach: its only exit is a portal resume.
    for (const current of ResumableSourceStatuses as number[]) {
        for (const createdThisRun of [false, true]) {
            test.each(allStatuses)(
                `a reconstruction held at ${AnnotationStatus[current]} refuses target %s (createdThisRun ${createdThisRun})`,
                (target: number) => {
                    expect(importMayTransition(current, target, createdThisRun)).toBe(false);
                });
        }
    }

    test.each((UntraceableSourceStatuses as number[]).filter(status => !isHeld(status)))(
        "Untraceable admits source status %s",
        (status: number) => {
            expect(importMayTransition(status, AnnotationStatus.Untraceable)).toBe(true);
        });

    test.each(allStatuses.filter(status => !(UntraceableSourceStatuses as number[]).includes(status) || isHeld(status)))(
        "Untraceable refuses source status %s",
        (status: number) => {
            expect(importMayTransition(status, AnnotationStatus.Untraceable)).toBe(false);
        });

    // Both review targets park by calling requestReview(PublishReview), so both carry the same exemption: a row a
    // previous run left parked is finished rather than skipped.  Getting this wrong skips rows the model would accept.
    for (const target of [AnnotationStatus.PublishReview, AnnotationStatus.Approved]) {
        test.each([...ReviewRequestSourceStatuses, AnnotationStatus.PublishReview] as number[])(
            `${AnnotationStatus[target]} admits source status %s`,
            (status: number) => {
                expect(importMayTransition(status, target)).toBe(true);
            });

        test.each(allStatuses.filter(status =>
            !(ReviewRequestSourceStatuses as number[]).includes(status) && status != AnnotationStatus.PublishReview))(
            `${AnnotationStatus[target]} refuses source status %s`,
            (status: number) => {
                expect(importMayTransition(status, target)).toBe(false);
            });
    }

    // The creation rule applies to hold targets only: a parked row is still finished on a later run.
    test.each([AnnotationStatus.PublishReview, AnnotationStatus.Approved])(
        "parking at PublishReview still admits target %s for a reconstruction that existed",
        (target: number) => {
            expect(importMayTransition(AnnotationStatus.PublishReview, target, false)).toBe(true);
        });

    // That arm makes no transition, so there is nothing to guard and nothing to skip a row over.
    test.each(allStatuses.filter(status => !isHeld(status)))("InProgress is not a guarded target, from %s", (status: number) => {
        expect(importMayTransition(status, AnnotationStatus.InProgress)).toBe(true);
    });

    test.each(ResumableSourceStatuses as number[])("InProgress is refused from held status %s", (status: number) => {
        expect(importMayTransition(status, AnnotationStatus.InProgress)).toBe(false);
    });
});

// Where the guard sits decides what a refused row keeps: everything between the immutable guard and the targetStatus
// switch either reports the row or writes to it, and the upload after the switch approves it.  Asserted against the
// source because smartSheetImport.ts is a CLI entry point that starts an import on load, so it cannot be required.
describe("the SmartSheet guard runs before anything writes to the row", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "tools", "smartSheetImport.ts"), "utf8");

    const guard = source.indexOf("importMayTransition(reconstruction.status, targetStatus, !reconstructionExisted)");

    test.each([
        ["the modified/added report entry", "importReport.reconstructionsModified.set"],
        ["the changed-neuron report entry", "importReport.existingNeuronsWithReconstructionChanges.add"],
        ["the metadata update", "await updateReconstructionMetadata(reconstruction"],
        ["the targetStatus switch", "switch (targetStatus)"],
        ["the specimen and atlas upload and approve", "await loadReconstructionData(reconstruction"]
    ])("before %s", (_unused: string, marker: string) => {
        expect(guard).toBeGreaterThan(0);
        expect(source.indexOf(marker)).toBeGreaterThan(guard);
    });

    // !reconstructionExisted means "created this run" only because it is computed before findOrOpenAnnotation.
    test("after the creation flag is computed", () => {
        const flag = source.indexOf("const reconstructionExisted");

        expect(flag).toBeGreaterThan(0);
        expect(flag).toBeLessThan(guard);
    });

    test("and reports the row it skips in its own bucket", () => {
        expect(source).toContain("importReport.reconstructionsSkippedStatus.push");
        expect(source).toContain("Reconstructions not Updated (status no longer admits the change)");
    });
});

describe("sheetExpectsReconstructionData", () => {
    test.each(allStatuses)("for target %s", (status: number) => {
        const expected = status == AnnotationStatus.PublishReview || status == AnnotationStatus.Approved;

        expect(sheetExpectsReconstructionData(status)).toBe(expected);
    });
});

describe("importLoadsExistingReconstruction", () => {
    const admittedTargets = [AnnotationStatus.InProgress, AnnotationStatus.PublishReview, AnnotationStatus.Approved, AnnotationStatus.Untraceable];

    for (const current of [AnnotationStatus.InProgress, AnnotationStatus.Rejected]) {
        test.each(admittedTargets)(`loads a reconstruction the portal holds at ${AnnotationStatus[current]} for target %s`, (target: number) => {
            expect(importLoadsExistingReconstruction(current, target)).toBe(true);
        });
    }

    test.each(allStatuses)("loads any current status %s for a PublishReview or Approved target", (current: number) => {
        expect(importLoadsExistingReconstruction(current, AnnotationStatus.PublishReview)).toBe(true);
        expect(importLoadsExistingReconstruction(current, AnnotationStatus.Approved)).toBe(true);
    });

    test.each([
        [AnnotationStatus.PeerReview, AnnotationStatus.InProgress],
        [AnnotationStatus.PublishReview, AnnotationStatus.Untraceable],
        [AnnotationStatus.OnHold, AnnotationStatus.InProgress]
    ])("does not load current status %s for target %s", (current: number, target: number) => {
        expect(importLoadsExistingReconstruction(current, target)).toBe(false);
    });
});

describe("the SmartSheet In Progress row", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "tools", "smartSheetImport.ts"), "utf8");

    test("goes through loading when the run creates it", () => {
        expect(source).toMatch(/case AnnotationStatus\.InProgress:\s*break;/);
    });

    test("loads an existing reconstruction the annotator still holds", () => {
        expect(source).toContain("importLoadsExistingReconstruction(reconstruction.status, targetStatus)");
    });

    test("tells both load calls whether the sheet expects the data", () => {
        expect(source.split("sheetExpectsReconstructionData(targetStatus)").length - 1).toBe(2);
    });

    // A speculative lookup at InProgress would otherwise put every such row in the not-found section on every run.
    test("reports a missing specimen file only when the data was expected", () => {
        expect(source).toMatch(/if \(expectData\) \{\s*specimenReconstructionNotFound\.push\(/);
        expect(source.split("specimenReconstructionNotFound.push(").length - 1).toBe(1);
    });

    test("reports a missing directory only through the directory cache", () => {
        expect(source).toContain("reconstructionDirectories.exists(subjectId, expectData)");
        expect(source).not.toContain("specimensMissingReconstructionDirectory");
    });

    // InProgress and Rejected are import-only sources, absent from the portal's map.
    test("admits an upload through the import's own source statuses", () => {
        expect(source).toContain("isImportUploadSourceStatus(space, reconstruction.status)");
        expect(source).not.toMatch(/import \{[^}]*\bUploadSourceStatuses\b[^}]*\} from "\.\.\/models\/user"/);
    });
});

describe("the SmartSheet hold mapping", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "tools", "smartSheetImport.ts"), "utf8");

    test("declares the sheet's Incomplete value", () => {
        expect(source).toContain('Incomplete = "Incomplete"');
        expect(source).not.toContain("// Incomplete");
    });

    test("admits Hold and Incomplete rows", () => {
        const body = source.slice(source.indexOf("function isReadyToImport"), source.indexOf("function reconstructionStatusForSmartSheetStatus"));

        expect(body).toContain("Status.Hold");
        expect(body).toContain("Status.Incomplete");
    });

    test("maps Incomplete onto its reconstruction status", () => {
        expect(source).toMatch(/case Status\.Incomplete:\s*return AnnotationStatus\.Incomplete;/);
    });

    // Pins disregardAuth and the skipped upload.
    test("holds an Incomplete row through markIncomplete and skips the upload", () => {
        expect(source).toMatch(/case AnnotationStatus\.Incomplete:\s*await Annotation\.markIncomplete\(reconstruction\.id, annotator, User\.SystemAutomationUser, true\);\s*continue;/);
    });
});
