import {DataTypes, Op, Sequelize} from "sequelize";

import {BaseModel} from "./baseModel";
import {Reconstruction} from "./reconstruction";


export class Precomputed extends BaseModel {
    public skeletonSegmentId?: number;
    public version?: number;
    public generatedAt?: Date;

    static async getPending(): Promise<Precomputed[]> {
        return await Precomputed.findAll({
            where: {
                "version": null,
                "generatedAt": null
            }
        })
    }

    static async markAsGenerated(id: string, version: number, generatedAt: number): Promise<Precomputed> {
        const precomputed = await Precomputed.findByPk(id)

        if (precomputed) {
            await precomputed.update({
                version,
                generatedAt
            });
        }

        return precomputed;
    }

    static async invalidate(ids: string[]): Promise<string[]> {
        const [_, rows] = await Precomputed.update({
            version: null,
            generatedAt: null
        }, {
            where: {
                "id": {[Op.in]: ids},
                "version": {[Op.ne]: null},
                "generatedAt": {[Op.ne]: null}
            },
            returning: true
        });

        return rows.map(r => r.id);
    }
}

export const modelInit = (sequelize: Sequelize) => {
    Precomputed.init({
        id: {
            primaryKey: true,
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4
        },
        skeletonSegmentId: {
            type: DataTypes.INTEGER
        },
        version: {
            type: DataTypes.INTEGER
        },
        generatedAt: DataTypes.DATE
    }, {
        tableName: "Precomputed",
        timestamps: true,
        paranoid: true,
        sequelize
    });
};

export const modelAssociate = () => {
    Precomputed.belongsTo(Reconstruction, {foreignKey: "reconstructionId", as: "Reconstruction"});
};
