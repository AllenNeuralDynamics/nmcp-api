import {BaseModel} from "./baseModel";
import {DataTypes, BelongsToGetAssociationMixin, Sequelize, Transaction} from "sequelize";

import {User} from "./user";
import {EventLogItemTableName} from "./tableNames";
import {AnnotationStatus} from "./annotationStatus";

export enum EventLogItemKind {
    Invalid = -1000,

    UserCreate = 1000,
    UserUpdate = 1010,

    IssueCreate = 1100,
    IssueUpdate = 1110,
    IssueClose = 1150,

    AccessRequestCreate = 1200,
    AccessRequestUpdate = 1210,
    AccessRequestApprove = 1220,
    AccessRequestDeny = 1230,

    ApiKeyCreate = 1300,
    ApiKeyUpdate = 1310,
    ApiKeyDelete = 1350,

    AtlasKindCreate = 2000,
    AtlasKindUpdate = 2010,
    AtlasCreate = 2050,
    AtlasUpdate = 2060,

    CollectionCreate = 2100,
    CollectionUpdate = 2110,

    GenotypeCreate = 2200,
    GenotypeUpdate = 2210,

    VirusCreate = 2300,
    VirusUpdate = 2310,

    FluorophoreCreate = 2400,
    FluorophoreUpdate = 2410,

    InjectionCreate = 2500,
    InjectionUpdate = 2510,
    InjectionDelete = 2550,

    SpecimenCreate = 3000,
    SpecimenUpdate = 3010,
    SpecimenUpdateSomaProperties = 3020,
    SpecimenDelete = 3050,

    NeuronCreate = 4000,
    NeuronUpdate = 4010,
    NeuronDelete = 4050,
    NeuronAssignDoi = 4080,

    CandidatesInsert = 4500,

    AnnotationCreate = 5000,
    AnnotationUpdate = 5010,
    // Retired by the annotation split and written by nothing; kept so the value is never reused and so rows from
    // before the split still name it.
    ReconstructionUpload = 5020,

    AnnotationPause = 5100,
    AnnotationResume = 5110,
    AnnotationIncomplete = 5120,
    AnnotationDuplicate = 5130,

    AnnotationRequestPeerReview = 5200,
    AnnotationRequestTeamReview = 5202,
    AnnotationRequestPublishReview = 5205,
    AnnotationApprovePeerReview = 5210,
    AnnotationApproveTeamReview = 5212,
    AnnotationApprovePublishReview = 5215,
    AnnotationFinalizeApprove = 5225,
    AnnotationReject = 5230,
    AnnotationDiscard = 5235,
    AnnotationUntraceable = 5240,

    AnnotationPublishing = 5300,
    AnnotationPublished = 5305,
    AnnotationAssignDoi = 5310,

    AnnotationArchive = 5900,

    AtlasReconstructionCreate = 6000,
    AtlasReconstructionUpdate = 6010,
    AtlasReconstructionUpload = 6020,

    AtlasReconstructionApprove = 6200,
    AtlasReconstructionReject = 6220,
    AtlasReconstructionDiscard = 6230,
    AtlasReconstructionPipelineReset = 6240,

    AtlasReconstructionRequestRegistration = 6300,
    AtlasReconstructionQualityControlRequest = 6400,
    AtlasReconstructionQualityControlComplete = 6420,
    AtlasReconstructionNodeStructureAssignmentRequest = 6500,
    AtlasReconstructionNodeStructureAssignmentComplete = 6520,
    AtlasReconstructionPrecomputedRequest = 6600,
    AtlasReconstructionPrecomputedComplete = 6620,
    AtlasReconstructionDoiAssignmentRequest = 6650,
    AtlasReconstructionDoiAssignmentComplete = 6670,
    AtlasReconstructionIndexingRequest = 6700,
    AtlasReconstructionIndexingComplete = 6720,

    AtlasReconstructionArchive = 6900,

    QualityControlCreate = 7000,
    QualityControlUpdate = 7010,
    QualityControlError = 7100,
    QualityControlPassed = 7110,
    QualityControlFailed = 7120,

    PrecomputedCreate = 8000,
    PrecomputedUpdate = 8010,
    PrecomputedComplete = 8100,
    PrecomputedError = 8120,

    SpecimenPrecomputedCreate = 9000,
    SpecimenPrecomputedUpdate = 9010,
    SpecimenPrecomputedComplete = 9100,
    SpecimenPrecomputedError = 9120,

    SpecimenSpaceReconstructionCreate = 10000,
    SpecimenSpaceReconstructionUpload = 10020,

    RawReconstructionUploadCreate = 11000,
    RawReconstructionUploadAccept = 11010,
    RawReconstructionUploadFail = 11020,
    RawReconstructionCreate = 11100
}

/**
 * The block raw reconstruction events are allocated from.  getNeuronVersionHistory excludes it: a raw reconstruction is
 * supporting data off the annotation, not a version of the neuron.
 */
export const RawReconstructionEventKindRange: readonly [number, number] = [11000, 11499];

/**
 * The event recorded for each review request target, and the set of targets requestReview admits: a status absent here
 * is not a review target at all, so the lookup that follows the guard cannot miss.
 *
 * Declared here rather than beside the source-status lists in annotation.ts, for the reason UploadSourceStatuses is
 * declared in user.ts: the values are EventLogItemKind members, and annotation.ts, user.ts and this file form a
 * require cycle, so dereferencing the enum at annotation.ts's module scope throws whenever the cycle is entered
 * from anywhere but there.  AnnotationStatus is a leaf module and safe to read from either side.
 */
export const ReviewRequestEventKinds: ReadonlyMap<AnnotationStatus, EventLogItemKind> = new Map([
    [AnnotationStatus.PeerReview, EventLogItemKind.AnnotationRequestPeerReview],
    [AnnotationStatus.TeamReview, EventLogItemKind.AnnotationRequestTeamReview],
    [AnnotationStatus.PublishReview, EventLogItemKind.AnnotationRequestPublishReview]
]);

export enum EventLogReferenceKind {
    Specimen = 1000,
    Neuron = 2000
}

export type EventLogItemReference = {
    kind: EventLogReferenceKind;
    id: string;
    reason: string;
}

export type EventLogItemReferences = {
    primary: EventLogItemReference[];
}

export type EventLogItemShape = {
    kind: EventLogItemKind;
    details?: any;
    targetId: string;
    parentId: string;
    userId: string;
    substituteUserId?: string;
    references?: EventLogItemReferences;
}

export async function recordEvent(item: EventLogItemShape, t: Transaction) {
    await EventLogItem.recordItem(item, t);
}

export class EventLogItem extends BaseModel {
    public kind: EventLogItemKind;
    public name: string;
    public details: any;
    public targetId: string;
    public references: EventLogItemReferences;

    public getUser!: BelongsToGetAssociationMixin<User>;

    public User?: User;

    public static async recordItem(item: EventLogItemShape, t: Transaction) {
        const validated = {
            ...item,
            name: EventLogItemKind[item.kind]
        };

        if (validated.details === null) {
            validated.details = "";
        }

        await EventLogItem.create(validated, {transaction: t});
    }
}

// noinspection JSUnusedGlobalSymbols
export const modelInit = (sequelize: Sequelize) => {
    return EventLogItem.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: Sequelize.literal("uuidv7()")
        },
        kind: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        name: {
            type: DataTypes.TEXT,
            defaultValue: ""
        },
        details: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        targetId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        parentId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        references: {
            type: DataTypes.JSONB,
            defaultValue: null
        },
        substituteUserId: {
            type: DataTypes.UUID,
            allowNull: true
        }
    }, {
        tableName: EventLogItemTableName,
        timestamps: true,
        updatedAt: false,
        deletedAt: false,
        sequelize
    });
};

// noinspection JSUnusedGlobalSymbols
export const modelAssociate = () => {
    EventLogItem.belongsTo(User, {foreignKey: "userId"});
};
