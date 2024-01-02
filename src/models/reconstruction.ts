import {BaseModel} from "./baseModel";
import {BelongsToGetAssociationMixin, DataTypes, Op, Sequelize} from "sequelize";
import {User} from "./user";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Neuron} from "./neuron";
import {IErrorOutput, IReconstructionPage, IReconstructionPageInput} from "../graphql/serverResolvers";
import {Tracing} from "./tracing";
import {ReconstructionTableName} from "./TableNames";
import {AxonStructureId, DendriteStructureId} from "./tracingStructure";

export class Reconstruction extends BaseModel {
    status: ReconstructionStatus;
    notes: string;
    checks: string;
    durationHours: number;
    lengthMillimeters: number;
    annotatorId: string;
    proofreaderId: string;
    neuronId: string;
    startedAt: Date;
    completedAt: Date;

    public getAnnotator!: BelongsToGetAssociationMixin<User>;
    public getProofreader!: BelongsToGetAssociationMixin<User>;
    public getNeuron!: BelongsToGetAssociationMixin<Neuron>;

    public static async getAll(queryInput: IReconstructionPageInput): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            matchCount: 0,
            reconstructions: []
        };

        let options = {where: {}};

        out.totalCount = await Reconstruction.count(options);

        if (queryInput) {
            out.matchCount = await Reconstruction.count(options);

            options["order"] = [["startedAt", "DESC"]];

            if (queryInput.offset) {
                options["offset"] = queryInput.offset;
                out.offset = queryInput.offset;
            }

            if (queryInput.limit) {
                options["limit"] = queryInput.limit;
                out.limit = queryInput.limit;
            }
        } else {
            out.matchCount = out.totalCount;
        }

        if (out.limit === 1) {
            out.reconstructions = [await Reconstruction.findOne(options)];
        } else {
            out.reconstructions = await Reconstruction.findAll(options);
        }

        return out;
    }

    /**
     * Count the number of reconstructions for a given neuron.
     *
     * @param neuronId
     *
     * @return the number of reconstructions
     */
    public static async getCountForNeuron(neuronId: string): Promise<number> {
        if (!neuronId || neuronId.length === 0) {
            return 0;
        }

        let options = {where: {}};

        options.where["neuronId"] = {[Op.eq]: neuronId}

        return Reconstruction.count(options);
    }

    public static async getForNeuron(neuronId: string):Promise<Reconstruction[]> {
        if (!neuronId || neuronId.length === 0) {
            return [];
        }

        return await Reconstruction.findAll({where:{neuronId: neuronId}})
    }

    public static async getAnnotationsForUser(userId: string): Promise<Reconstruction[]> {
        return Reconstruction.findAll({
            where: {annotatorId: userId}
        });
    }

    public static async getReviewableAnnotations(): Promise<Reconstruction[]> {
        return Reconstruction.findAll({
            where: {status: ReconstructionStatus.InReview}
        });
    }

    public static async markAnnotationForReview(id: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.InReview});

        return null;
    }

    public static async markAnnotationOnHold(id: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.OnHold});

        return null;
    }

    public static async approveAnnotation(id: string, proofreaderId: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.Approved, proofreaderId: proofreaderId});

        return null;
    }

    public static async declineAnnotation(id: string, proofreaderId: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({status: ReconstructionStatus.Rejected, proofreaderId: proofreaderId});

        return null;
    }

    public static async completeAnnotation(id: string, duration: number, length: number, notes: string, checks: string): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await reconstruction.update({
            status: ReconstructionStatus.Complete,
            durationHours: duration,
            lengthMillimeters: length,
            notes: notes,
            checks: checks,
            completedAt: Date.now()
        });

        return null;
    }

    public static async reopenAnnotationAsApproved(id: string): Promise<void> {
        const reconstruction = await Reconstruction.findByPk(id);

        await reconstruction.update({status: ReconstructionStatus.Approved});
    }

    public static async cancelAnnotation(id: string): Promise<IErrorOutput> {
        const annotation = await Reconstruction.findByPk(id);

        if (!annotation) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await annotation.update({
            status: ReconstructionStatus.Cancelled
        });

        return null;
    }

    public static async remove(id: string): Promise<boolean> {
        await Reconstruction.destroy({
            where: {id: id}
        });

        return true;
    }

    public async getAxon(): Promise<Tracing> {
        return await Tracing.findOne({
            where: {reconstructionId: this.id, tracingStructureId: AxonStructureId}
        });
    }

    public async getDendrite(): Promise<Tracing> {
        return await Tracing.findOne({
            where: {reconstructionId: this.id, tracingStructureId: DendriteStructureId}
        });
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Reconstruction.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        status: DataTypes.INTEGER,
        notes: DataTypes.TEXT,
        checks: DataTypes.TEXT,
        durationHours: DataTypes.DOUBLE,
        lengthMillimeters: DataTypes.DOUBLE,
        startedAt: DataTypes.DATE,
        completedAt: DataTypes.DATE,
    }, {
        tableName: ReconstructionTableName,
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Reconstruction.belongsTo(User, {foreignKey: "annotatorId", as: "Annotator"});
    Reconstruction.belongsTo(User, {foreignKey: "proofreaderId", as: "Proofreader"});
    Reconstruction.belongsTo(Neuron, {foreignKey: "neuronId", as: "Neuron"});
    Reconstruction.hasMany(Tracing, {foreignKey: "reconstructionId", as: "Tracings"});
};
