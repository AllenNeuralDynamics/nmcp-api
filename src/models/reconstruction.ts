import {BelongsToGetAssociationMixin, DataTypes, Op, Sequelize} from "sequelize";
import {concat, uniqBy} from "lodash"

import {ReconstructionTableName} from "./TableNames";
import {BaseModel} from "./baseModel";
import {Neuron} from "./neuron";
import {ReconstructionStatus} from "./reconstructionStatus";
import {Tracing} from "./tracing";
import {AxonStructureId, DendriteStructureId} from "./tracingStructure";
import {User} from "./user";
import {IErrorOutput, IReconstructionPage, IReconstructionPageInput, ReviewPageInput} from "../graphql/secureResolvers";
import {Precomputed} from "./precomputed";
import {TracingNode} from "./tracingNode";
import {StructureIdentifier} from "./structureIdentifier";
import {BrainArea} from "./brainArea";
import {Sample} from "./sample";
import {Fluorophore} from "./fluorophore";
import {InjectionVirus} from "./injectionVirus";
import {Injection} from "./injection";
import {MouseStrain} from "./mouseStrain";
import {SearchContent} from "./searchContent";
import {removeTracingFromMiddlewareCache} from "../rawquery/tracingQueryMiddleware";

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
    public readonly Tracings: Tracing[];

    private static _reconstructionCount: number = 0;

    public static async getAll(queryInput: IReconstructionPageInput, userId: string = null): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            reconstructions: []
        };

        let options = userId ? {where: {annotatorId: userId}, include: []} : {where: {}, include: []};

        if (queryInput.filters && queryInput.filters.length > 0) {
            options.where[Op.or] = queryInput.filters.map(f => {
                return {status: f};
            })
        }

        if (queryInput.sampleIds && queryInput.sampleIds.length > 0) {
            options.where["$Neuron.Sample.id$"] = {[Op.in]: queryInput.sampleIds}
            options.include.push({model: Neuron, as: "Neuron", include: [{model: Sample, as: "Sample"}]});
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

    public static async isUserAnnotator(id: string, userId: string): Promise<boolean> {
        const reconstruction = await Reconstruction.findByPk(id, {
            attributes: ["annotatorId"]
        })

        return reconstruction && reconstruction.annotatorId == userId;
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

    public static async getReviewableAnnotations(input: ReviewPageInput): Promise<IReconstructionPage> {
        let out: IReconstructionPage = {
            offset: 0,
            limit: 0,
            totalCount: 0,
            reconstructions: []
        };

        try {
            out.totalCount = await Reconstruction.count({
                where: {
                    [Op.or]: [
                        {status: ReconstructionStatus.InReview},
                        {status: ReconstructionStatus.Approved}
                    ]
                }
            });

            const options = {where: {}, include: []};

            if (input.status && input.status.length > 0) {
                options.where[Op.or] = input.status.map(f => {
                    return {status: f};
                })
            } else {
                options.where[Op.or] = [
                    {status: ReconstructionStatus.InReview},
                    {status: ReconstructionStatus.Approved}
                ]
            }

            if (input.sampleIds && input.sampleIds.length > 0) {
                options.where["$Neuron.Sample.id$"] = {[Op.in]: input.sampleIds}
                options.include.push({model: Neuron, as: "Neuron", include: [{model: Sample, as: "Sample"}]});
            }

            out.totalCount = await Reconstruction.count(options);

            if (input) {
                options["order"] = [["startedAt", "DESC"]];

                if (input.offset) {
                    options["offset"] = input.offset;
                    out.offset = input.offset;
                }

                if (input.limit) {
                    options["limit"] = input.limit;
                    out.limit = input.limit;
                }
            }

            if (out.limit === 1) {
                out.reconstructions = [await Reconstruction.findOne(options)];
            } else {
                out.reconstructions = await Reconstruction.findAll(options);
            }
        } catch (err) {
            debug(err);
        }

        return out;
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
        const reconstruction = await Reconstruction.findByPk(id);

        if (!reconstruction) {
            return {
                message: "The reconstruction could not be found",
                name: "NotFound"
            }
        }

        await Reconstruction.destroy({
            where: {id: id}
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

    public static async getAsData(id: string): Promise<string> {
        const reconstruction = await Reconstruction.findByPk(id, {
            include: [{
                model: Neuron,
                as: "Neuron",
                include: [{
                    model: Sample,
                    as: "Sample",
                    include: [{
                        model: Injection,
                        as: "Injections",
                        include: [{
                            model: InjectionVirus,
                            as: "InjectionVirus"
                        }, {
                            model: Fluorophore,
                            as: "Fluorophore"
                        }]
                    }, {
                        model: MouseStrain,
                        as: "MouseStrain"
                    }]
                }]
            }, {
                model: Tracing,
                as: "Tracings",
                include: [{
                    model: TracingNode,
                    as: "Nodes",
                    include: [{
                        model: StructureIdentifier,
                        as: "StructureIdentifier"
                    }, {
                        model: BrainArea,
                        as: "BrainArea"
                    }]
                }]
            }]
        });


        if (reconstruction && reconstruction.Tracings.length == 2) {
            let axon = [];
            let axonId = null;

            let dendrite = [];
            let dendriteId = null;

            let nodes = mapNodes(reconstruction.Tracings[0].Nodes).sort((a, b) => a.sampleNumber - b.sampleNumber);

            if (reconstruction.Tracings[0].tracingStructureId == "68e76074-1777-42b6-bbf9-93a6a5f02fa4") {
                axon = nodes;
                axonId = reconstruction.Tracings[0].id;
            } else {
                dendrite = nodes
                dendriteId = reconstruction.Tracings[0].id;
            }

            const structures1 = reconstruction.Tracings[0].Nodes.filter(n => n.BrainArea).map(n => n.BrainArea);

            nodes = mapNodes(reconstruction.Tracings[1].Nodes).sort((a, b) => a.sampleNumber - b.sampleNumber);

            if (reconstruction.Tracings[1].tracingStructureId == "68e76074-1777-42b6-bbf9-93a6a5f02fa4") {
                axon = nodes;
                axonId = reconstruction.Tracings[1].id;
            } else {
                dendrite = nodes
                dendriteId = reconstruction.Tracings[1].id;
            }

            const structures2 = reconstruction.Tracings[1].Nodes.filter(n => n.BrainArea).map(n => n.BrainArea);

            const structures: BrainArea[] = uniqBy(concat(structures1, structures2), "id")

            const soma = nodes.filter(n => n.sampleNumber == 1);

            const allenInfo = structures.map(s => {
                return {
                    allenId: s.structureId,
                    name: s.name,
                    safeName: s.safeName,
                    acronym: s.acronym,
                    graphOrder: s.graphOrder,
                    structurePath: s.structureIdPath,
                    colorHex: s.geometryColor
                }
            })

            const label = reconstruction.Neuron.Sample.Injections.map(i => {
                return {
                    virus: i.injectionVirus.name,
                    fluorophore: i.fluorophore.name
                }
            })

            const sample = {
                date: reconstruction.Neuron.Sample.sampleDate,
                subject: reconstruction.Neuron.Sample.animalId,
                genotype: reconstruction.Neuron.Sample.mouseStrain?.name || null
            };

            if (soma.length > 0) {
                const obj = {
                    comment: "",
                    neurons: [
                        {
                            id: reconstruction.Neuron.id,
                            idString: reconstruction.Neuron.idString,
                            DOI: reconstruction.Neuron.doi,
                            sample,
                            label: label.length > 0 ? label : null,
                            annotationSpace: {
                                version: 3,
                                description: "Annotation Space: CCFv3.0 Axes> X: Anterior-Posterior; Y: Inferior-Superior; Z:Left-Right"
                            },
                            soma: {
                                x: soma[0].x,
                                y: soma[0].y,
                                z: soma[0].z,
                                allenId: soma[0].allenId
                            },
                            axonId,
                            axon,
                            dendriteId,
                            dendrite,
                            allenInformation: allenInfo
                        }
                    ]
                }

                return JSON.stringify(obj);
            }
        }

        return null;
    }

    public static async unpublish(id: string): Promise<boolean> {
        if (!id) {
            return false;
        }

        const reconstruction = await Reconstruction.findByPk(id, {
            include: [{
                model: Tracing,
                as: "Tracings",
                include: [{
                    model: TracingNode,
                    as: "Nodes",
                    include: [{
                        model: StructureIdentifier,
                        as: "StructureIdentifier"
                    }, {
                        model: BrainArea,
                        as: "BrainArea"
                    }]
                }]
            }]
        });

        if (!reconstruction) {
            return false;
        }

        let nodes = [];

        reconstruction.Tracings.forEach(n => {
            nodes = nodes.concat(n.Nodes)
        })

        try {
            await TracingNode.sequelize.transaction(async (transaction) => {
                let promises = reconstruction.Tracings.map(async (t) => {
                    await TracingNode.update({brainStructureId: null}, {where: {tracingId: t.id}, transaction});
                });

                await Promise.all(promises);

                promises = reconstruction.Tracings.map(async (t) => {
                    await t.update({nodeLookupAt: null, searchTransformAt: null}, {transaction});
                })

                await Promise.all(promises);

                await reconstruction.update({status: ReconstructionStatus.Approved}, {transaction});

                promises = reconstruction.Tracings.map(async (t) => {
                    await SearchContent.destroy({where: {tracingId: t.id}, transaction});
                });

                await Promise.all(promises);
            });

            removeTracingFromMiddlewareCache(id);

            debug(`unpublished reconstruction ${id}`);
        } catch (err) {
            debug(err);
            return false;
        }

        await this.loadReconstructionCache()

        return true;
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
    Reconstruction.hasOne(Precomputed, {foreignKey: "reconstructionId", as: "Precomputed"});
};

function mapNodes(nodes: TracingNode[]) {
    return nodes.map(n => {
        return {
            sampleNumber: n.sampleNumber,
            structureIdentifier: n.StructureIdentifier.value,
            x: n.z,
            y: n.y,
            z: n.x,
            radius: n.radius,
            parentNumber: n.parentNumber,
            allenId: n.BrainArea ? n.BrainArea.structureId : null
        }
    });
}
