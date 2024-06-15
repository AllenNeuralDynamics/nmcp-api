import {BelongsToGetAssociationMixin, DataTypes, Op, Sequelize} from "sequelize";

import {ReconstructionTableName} from "./TableNames";
import {BaseModel} from "./baseModel";
import {Neuron} from "./neuron";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Tracing} from "./tracing";
import {AxonStructureId, DendriteStructureId} from "./tracingStructure";
import {User} from "./user";
import {IErrorOutput, IReconstructionPage, IReconstructionPageInput} from "../graphql/serverResolvers";

const debug = require("debug")("mnb:nmcp-api:reconstruction-model");

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

    public readonly Neuron: Neuron;

    private static _reconstructionCount: number = 0;

    public static async getAll(queryInput: IReconstructionPageInput, userId: string = null): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            reconstructions: []
        };

        let options = userId ? {where: {annotatorId: userId}} : {where: {}};

        if (queryInput.filters && queryInput.filters.length > 0) {
            const filters = queryInput.filters.map(f => {
                return {status: f};
            });
            options.where[Op.or] = filters
        }

        out.totalCount = await Reconstruction.count(options);

        if (queryInput) {
            options["order"] = [["startedAt", "DESC"]];

            if (queryInput.offset) {
                options["offset"] = queryInput.offset;
                out.offset = queryInput.offset;
            }

            if (queryInput.limit) {
                options["limit"] = queryInput.limit;
                out.limit = queryInput.limit;
            }
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

    public static async getForNeuron(neuronId: string): Promise<Reconstruction[]> {
        if (!neuronId || neuronId.length === 0) {
            return [];
        }

        return await Reconstruction.findAll({where: {neuronId: neuronId}})
    }

    public static async getAnnotationsForUser(userId: string): Promise<Reconstruction[]> {
        return Reconstruction.findAll({
            where: {annotatorId: userId}
        });
    }

    public static async getReviewableAnnotations(): Promise<Reconstruction[]> {
        return Reconstruction.findAll({
            where: {
                [Op.or]: [
                    {status: ReconstructionStatus.InReview},
                    {status: ReconstructionStatus.Approved}
                ]
            }
        });
    }

    public static async updateReconstruction(id: string, duration: number, length: number, notes: string, checks: string, markForReview: boolean = false): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        const update = {
            durationHours: duration,
            lengthMillimeters: length,
            notes: notes,
            checks: checks
        }

        if (markForReview) {
            update["status"] = ReconstructionStatus.InReview;
        }

        await reconstruction.update(update);

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

    public static async completeAnnotation(id: string): Promise<IErrorOutput> {
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await reconstruction.update({
            status: ReconstructionStatus.Complete,
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

    public static reconstructionCount() {
        return this._reconstructionCount;
    }

    public static async loadReconstructionCache() {
        try {
            debug(`loading reconstructions`);

            const reconstructions: Reconstruction[] = await Reconstruction.findAll({
                where: {
                    status: ReconstructionStatus.Complete
                }
            });

            this._reconstructionCount = reconstructions.length;

            debug(`${this._reconstructionCount} completed reconstructions`);
        } catch (err) {
            debug(err)
        }
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
