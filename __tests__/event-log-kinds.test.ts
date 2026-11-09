import {expect, test, describe} from "vitest";

// Use require() to get the CJS module instance the compiled sources use (a plain ESM import yields a separate
// instance under vitest).
const {EventLogItemKind, RawReconstructionEventKindRange, ReviewRequestEventKinds} = require("../src/models/eventLogItem");
const {AnnotationStatus} = require("../src/models/annotationStatus");

// The forward members only: a numeric enum's reverse mapping keeps one name per value, so a collision disappears from
// it and a count taken through it always agrees with itself.
const memberNames = Object.keys(EventLogItemKind).filter(key => isNaN(Number(key)));

describe("annotation event kinds", () => {
    // Stored rows carry these numbers, so the rename must not move any of them.
    const renamed: [string, number][] = [
        ["AnnotationCreate", 5000],
        ["AnnotationUpdate", 5010],
        ["AnnotationPause", 5100],
        ["AnnotationResume", 5110],
        ["AnnotationIncomplete", 5120],
        ["AnnotationDuplicate", 5130],
        ["AnnotationRequestPeerReview", 5200],
        ["AnnotationRequestTeamReview", 5202],
        ["AnnotationRequestPublishReview", 5205],
        ["AnnotationApprovePeerReview", 5210],
        ["AnnotationApproveTeamReview", 5212],
        ["AnnotationApprovePublishReview", 5215],
        ["AnnotationFinalizeApprove", 5225],
        ["AnnotationReject", 5230],
        ["AnnotationDiscard", 5235],
        ["AnnotationUntraceable", 5240],
        ["AnnotationPublishing", 5300],
        ["AnnotationPublished", 5305],
        ["AnnotationAssignDoi", 5310],
        ["AnnotationArchive", 5900]
    ];

    test.each(renamed)("%s is %i", (name: string, value: number) => {
        expect(EventLogItemKind[name]).toBe(value);
    });

    test("the retired upload kind keeps 5020 and no annotation kind takes it", () => {
        expect(EventLogItemKind.ReconstructionUpload).toBe(5020);

        const annotationValues = memberNames.filter(name => name.startsWith("Annotation")).map(name => EventLogItemKind[name]);

        expect(annotationValues).not.toContain(5020);
    });

    test("no member name keeps the old prefix except the retired upload kind", () => {
        expect(memberNames.filter(name => name.startsWith("Reconstruction"))).toEqual(["ReconstructionUpload"]);
    });
});

describe("specimen-space event kinds", () => {
    test("SpecimenSpaceReconstructionCreate is 10000", () => {
        expect(EventLogItemKind.SpecimenSpaceReconstructionCreate).toBe(10000);
    });

    test("SpecimenSpaceReconstructionUpload is 10020", () => {
        expect(EventLogItemKind.SpecimenSpaceReconstructionUpload).toBe(10020);
    });
});

describe("EventLogItemKind", () => {
    test("no two members share a value", () => {
        const values = memberNames.map(name => EventLogItemKind[name]);

        expect(new Set(values).size).toBe(memberNames.length);
    });
});

describe("ReviewRequestEventKinds", () => {
    test("maps each review target to its annotation request kind", () => {
        expect([...ReviewRequestEventKinds.entries()]).toEqual([
            [AnnotationStatus.PeerReview, EventLogItemKind.AnnotationRequestPeerReview],
            [AnnotationStatus.TeamReview, EventLogItemKind.AnnotationRequestTeamReview],
            [AnnotationStatus.PublishReview, EventLogItemKind.AnnotationRequestPublishReview]
        ]);
    });
});

describe("raw reconstruction event kinds", () => {
    test.each([
        ["RawReconstructionUploadCreate", 11000],
        ["RawReconstructionUploadAccept", 11010],
        ["RawReconstructionUploadFail", 11020],
        ["RawReconstructionCreate", 11100]
    ])("%s is %i", (name: string, value: number) => {
        expect(EventLogItemKind[name]).toBe(value);
    });

    test("the range is 11000-11499", () => {
        expect(RawReconstructionEventKindRange).toEqual([11000, 11499]);
    });

    test("every Raw member lies in the range and no other member does", () => {
        const [low, high] = RawReconstructionEventKindRange;

        for (const name of memberNames) {
            const value = EventLogItemKind[name];

            expect(value >= low && value <= high, name).toBe(name.startsWith("Raw"));
        }
    });
});
