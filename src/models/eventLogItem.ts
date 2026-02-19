import {BaseModel} from "./baseModel";
import {DataTypes, BelongsToGetAssociationMixin, Sequelize, Transaction} from "sequelize";

import {User} from "./user";
import {EventLogItemTableName} from "./tableNames";

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

    // ApiKey 1300

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

    CandidatesInsert = 4500,

    ReconstructionCreate = 5000,
    ReconstructionUpdate = 5010,
    ReconstructionUpload = 5020,

    ReconstructionPause = 5100,
    ReconstructionResume = 5110,

    ReconstructionRequestPeerReview = 5200,
    ReconstructionRequestPublishReview = 5205,
    ReconstructionApprovePeerReview = 5210,
    ReconstructionApprovePublishReview = 5215,
    ReconstructionFinalizeApprove = 5225,
    ReconstructionReject = 5230,
    ReconstructionDiscard = 5235,

    ReconstructionPublishing = 5300,
    ReconstructionPublished = 5305,
    ReconstructionAssignDoi = 5310,

    ReconstructionArchive = 5900,

    AtlasReconstructionCreate = 6000,
    AtlasReconstructionUpdate = 6010,
    AtlasReconstructionUpload = 6020,

    AtlasReconstructionApprove = 6200,
    AtlasReconstructionReject = 6220,
    AtlasReconstructionDiscard = 6230,

    AtlasReconstructionRequestRegistration = 6300,
    AtlasReconstructionQualityControlRequest = 6400,
    AtlasReconstructionQualityControlComplete = 6420,
    AtlasReconstructionNodeStructureAssignmentRequest = 6500,
    AtlasReconstructionNodeStructureAssignmentComplete = 6520,
    AtlasReconstructionPrecomputedRequest = 6600,
    AtlasReconstructionPrecomputedComplete = 6620,
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
    SpecimenPrecomputedError = 9120
}

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
