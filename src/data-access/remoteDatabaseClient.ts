import * as path from "path";
import * as fs from "fs";
import {Sequelize, QueryInterface, Options} from "sequelize";

const debug = require("debug")("nmcp:nmcp-api:database-connector");

import {SequelizeOptions} from "../options/coreServicesOptions";
import {ServiceOptions} from "../options/serviceOptions";
import {AtlasStructure, AtlasStructureShape} from "../models/atlasStructure";
import {NodeStructure} from "../models/nodeStructure";
import {NeuronStructure} from "../models/neuronStructure";
import {AtlasReconstruction} from "../models/atlasReconstruction";
import {AtlasKind, AtlasKindShape} from "../models/atlasKind";
import {Atlas, AtlasShape} from "../models/atlas";
import {User} from "../models/user";

export class RemoteDatabaseClient {
    public static async Start(prepareSearchContents = false, enableLog: boolean = false): Promise<RemoteDatabaseClient> {
        const client = new RemoteDatabaseClient(SequelizeOptions);
        await client.start(prepareSearchContents, enableLog);
        return client;
    }

    private _connection: Sequelize;
    private _enableLog: boolean;
    private readonly _options: Options;

    private constructor(options: Options) {
        this._options = options;
    }

    private async start(prepareSearchContents: boolean, enableLog: boolean) {
        this._enableLog = enableLog;

        this.createConnection(this._options);

        const models = this.loadModels();

        await this.authenticate("nmcp");

        // Special case due to some portions of seeding wanting to attribute creation to the system internal user.
        await User.loadCache();

        await this.seedIfRequired();

        await this.prepareRequiredConstants(models);

        if (prepareSearchContents) {
            await this.prepareSearchContents();
        }
    }

    private createConnection(options: Options): void {
        this._connection = new Sequelize(options.database, options.username, options.password, options);
    }

    private async authenticate(name: string) {
        try {
            await this._connection.authenticate();

            this.log(`successful database connection: ${name}`);

        } catch (err) {
            if (err.name === "SequelizeConnectionRefusedError") {
                this.log(`failed database connection: ${name} (connection refused - is it running?) - delaying 5 seconds`);
            } else {
                this.log(`failed database connection: ${name} - delaying 5 seconds`);
                this.log(err);
            }

            setTimeout(() => this.authenticate(name), 5000);
        }
    }

    private loadModels(): any[] {
        const location = path.normalize(path.join(__dirname, "..", "models"))

        const modules: any[] = fs.readdirSync(location).filter(f => f.endsWith(".js")).map(f => require(path.join(location, f.slice(0, -3))));

        const models = modules.filter(m => m.modelInit).map(m => m.modelInit(this._connection));

        for (const model of modules) {
            if (model.modelAssociate != null) {
                model.modelAssociate();
            }
        }

        return models;
    }

    private async prepareRequiredConstants(models: any[]): Promise<void> {
        this.log("preparing required constants");

        for (const model of models) {
            await model.loadCache();
        }
    }

    private async prepareSearchContents() {
        this.log("preparing search contents");
    }

    private async seedIfRequired() {
        const queryInterface: QueryInterface = this._connection.getQueryInterface();

        const when = new Date();

        try {
            let count = await AtlasStructure.count();

            if (count == 0) {
                this.log("seeding atlas");

                const [atlasKindInfo, atlasInfo, structures] = loadAtlasStructures(when);

                await AtlasStructure.sequelize.transaction(async (t) => {
                    const atlasKind = await AtlasKind.createForShape(atlasKindInfo, User.SystemInternalUser, t);

                    const atlas = await Atlas.createForShape({...atlasInfo, atlasKindId: atlasKind.id}, User.SystemInternalUser, t);

                    const atlasStructures = structures.map(s => ({...s, atlasId: atlas.id}));

                    const chunkSize = 500;

                    for (let idx = 0; idx < atlasStructures.length; idx += chunkSize) {
                        await AtlasStructure.bulkCreate(atlasStructures.slice(idx, idx + chunkSize), {transaction: t});
                    }
                });
            } else {
                this.log("skipping atlas seed");
            }

            count = await NodeStructure.count();

            if (count == 0) {
                this.log("seeding node structures");
                await NodeStructure.bulkCreate(loadNodeStructures(when), {});
            } else {
                this.log("skipping node structures seed");
            }

            count = await NeuronStructure.count();

            if (count == 0) {
                this.log("seeding neuron structures");
                await NeuronStructure.bulkCreate(loadNeuronStructures(when), {});
            } else {
                this.log("skipping neuron seed");
            }
        } catch (err) {
            this.log(err);
        }

        this.log("seed complete");
    }

    private log(message: any) {
        if (this._enableLog) {
            debug(`${message}`);
        }
    }
}

function loadAtlasStructures(when: Date): [AtlasKindShape, AtlasShape, AtlasStructureShape[]] {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "ccfv3Atlas.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const atlasInfo = JSON.parse(fileData);

    const atlasKind: AtlasKindShape = {
        kind: atlasInfo.atlasKind.kind,
        family: atlasInfo.atlasKind.family,
        name: atlasInfo.atlasKind.name,
        description: atlasInfo.atlasKind.description
    }

    const atlas: AtlasShape = {
        name: atlasInfo.atlas.name,
        description: atlasInfo.atlas.description,
        reference: atlasInfo.atlas.reference,
        geometryUrl: atlasInfo.atlas.geometryUrl,
        rootStructureId: atlasInfo.atlas.rootStructureId,
        spatialUrl: ServiceOptions.ccfv30OntologyPath
    }

    const structures = atlasInfo.atlas.structures.map((n: any) => {
        const s = {...n};

        delete s.id;
        s.updatedAt = null;
        s.createdAt = when;

        return s;
    });

    return [atlasKind, atlas, structures];
}

function loadNodeStructures(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "nodeStructures.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map((a: any) => {
        a.updatedAt = null;
        a.createdAt = when;

        return a;
    });
}

function loadNeuronStructures(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "neuronStructures.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map((a: any) => {
        a.updatedAt = null;
        a.createdAt = when;

        return a;
    });
}
