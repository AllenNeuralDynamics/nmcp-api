import {BaseModel} from "./baseModel";
import {BelongsToGetAssociationMixin, DataTypes, Sequelize} from "sequelize";
import {User} from "./user";
import {AnnotationStatus} from "./annotationStatus";
import {Neuron} from "./neuron";
import {IErrorOutput} from "../graphql/serverResolvers";

export class Annotation extends BaseModel {
    status: AnnotationStatus;
    notes: string;
    durationMinutes: number;
    annotatorId: string;
    tracingId: string;
    startedAt: Date;
    completedAt: Date;

    public getAnnotator!: BelongsToGetAssociationMixin<User>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;

    public static async getAnnotationsForUser(userId: string): Promise<Annotation[]> {
        return Annotation.findAll({
            where: {annotatorId: userId}
        });
    }

    public static async getReviewableAnnotations(): Promise<Annotation[]> {
        return Annotation.findAll({
            where: {status: AnnotationStatus.InReview}
        });
    }

    public static async markAnnotationForReview(id: string): Promise<IErrorOutput> {
        const annotation = await Annotation.findByPk(id);

        if (!annotation) {
            return {
                message: "The annotation could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: AnnotationStatus.InReview});

        return null;
    }

    public static async markAnnotationOnHold(id: string): Promise<IErrorOutput> {
        const annotation = await Annotation.findByPk(id);

        if (!annotation) {
            return {
                message: "The annotation could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: AnnotationStatus.OnHold});

        return null;
    }

    public static async approveAnnotation(id: string): Promise<IErrorOutput> {
        const annotation = await Annotation.findByPk(id);

        if (!annotation) {
            return {
                message: "The annotation could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: AnnotationStatus.Approved});

        return null;
    }

    public static async declineAnnotation(id: string): Promise<IErrorOutput> {
        const annotation = await Annotation.findByPk(id);

        if (!annotation) {
            return {
                message: "The annotation could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: AnnotationStatus.Rejected});

        return null;
    }

    public static async completeAnnotation(annotatorId: string, neuronId: string): Promise<boolean> {
        const annotation = await Annotation.findOne({
            where: {annotatorId: annotatorId, neuronId: neuronId}
        });

        if (!annotation) {
            return false;
        }

        await annotation.update({status: AnnotationStatus.Complete});

        return true;
    }


    public static async cancelAnnotation(id: string): Promise<IErrorOutput> {
        const annotation = await Annotation.findByPk(id);

        if (!annotation) {
            return {
                message: "The annotation could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({
            status: AnnotationStatus.Cancelled
        });

        return null;
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Annotation.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        status: DataTypes.INTEGER,
        notes: DataTypes.TEXT,
        durationMinutes: DataTypes.INTEGER,
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE,
    }, {
        tableName: "Annotation",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Annotation.belongsTo(User, {foreignKey: "annotatorId", as: "Annotator"});
    Annotation.belongsTo(Neuron, {foreignKey: "neuronId", as: "Neuron"});
};
