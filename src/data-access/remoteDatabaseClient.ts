import * as path from "path";
import * as fs from "fs";
import {Options, QueryInterface, Sequelize} from "sequelize";
import {SequelizeOptions} from "../options/coreServicesOptions";
import {ServiceOptions} from "../options/serviceOptions";
import {AtlasStructure, AtlasStructureShape} from "../models/atlasStructure";
import {NodeStructure} from "../models/nodeStructure";
import {NeuronStructure} from "../models/neuronStructure";
import {AtlasKind, AtlasKindShape} from "../models/atlasKind";
import {Atlas, AtlasShape} from "../models/atlas";
import {User} from "../models/user";

const debug = require("debug")("nmcp:nmcp-api:database-connector");

const ccfv3AtlasSource = "ccfv3Atlas.json";

export class RemoteDatabaseClient {
    public static async Start(prepareSearchContents = false, enableLog: boolean = false, forceLocalHost: boolean = false): Promise<RemoteDatabaseClient> {
        if (forceLocalHost) {
            SequelizeOptions.host = "localhost";
        }
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

        for (const module of modules) {
            if (module.modelAssociate != null) {
                module.modelAssociate();
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

        const sources = [ccfv3AtlasSource, "marmosetAtlas.json"];

        try {
            const atlasKinds = loadAtlasKinds(when);

            let count = await AtlasKind.count();

            if (count < atlasKinds.length) {
                this.log("seeding atlas kinds");

                await AtlasKind.sequelize.transaction(async (t) => {
                    for (const atlasKind of atlasKinds) {
                        await AtlasKind.createForShape(atlasKind, User.SystemInternalUser, t);
                    }
                });
            } else {
                this.log("skipping atlas kinds seed");
            }

            count = await Atlas.count();

            if (count < sources.length) {
                this.log("seeding atlases");

                for (const source of sources) {
                    const [atlasInfo, structures] = loadAtlasStructures(source, when);

                    const {kind, ...atlasShape} = atlasInfo;

                    if (await Atlas.findOne({where: {name: atlasShape.name}})) {
                        this.log(`skipping existing atlas ${atlasShape.name}`);
                        continue;
                    }

                    const atlasKind = await AtlasKind.findOne({where: {kind}});

                    if (!atlasKind) {
                        this.log(`skipping atlas ${atlasShape.name}: no atlas kind ${kind}`);
                        continue;
                    }

                    await Atlas.sequelize.transaction(async (t) => {
                        const atlas = await Atlas.createForShape({
                            ...atlasShape,
                            atlasKindId: atlasKind.id
                        }, User.SystemInternalUser, t);

                        const atlasStructures = structures.map(s => ({...s, atlasId: atlas.id}));

                        const chunkSize = 500;

                        for (let idx = 0; idx < atlasStructures.length; idx += chunkSize) {
                            await AtlasStructure.bulkCreate(atlasStructures.slice(idx, idx + chunkSize), {transaction: t});
                        }
                    });
                }
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

function loadAtlasKinds(when: Date): AtlasKindShape[] {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "atlasKind.json");

    const fileData = fs.readFileSync(fixtureDataPath, "utf-8");

    const atlasInfo: AtlasKindShape[] = JSON.parse(fileData);

    return atlasInfo.map((s: AtlasKindShape) => ({
        kind: s.kind,
        family: s.family,
        name: s.name,
        description: s.description
    }));
}

function loadAtlasStructures(source: string, when: Date): [AtlasShape, AtlasStructureShape[]] {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, source);

    const fileData = fs.readFileSync(fixtureDataPath, "utf-8");

    const atlasInfo = JSON.parse(fileData);

    const atlas: AtlasShape = {
        name: atlasInfo.atlas.name,
        description: atlasInfo.atlas.description,
        kind: atlasInfo.atlas.atlasKind,
        reference: atlasInfo.atlas.reference,
        geometryUrl: atlasInfo.atlas.geometryUrl,
        rootStructureId: atlasInfo.atlas.rootStructureId
    }

    // Only CCFv3 has a volume for now; every other atlas keeps the column default (null).
    if (source === ccfv3AtlasSource) {
        atlas.spatialUrl = ServiceOptions.ccfv30OntologyPath;
    }

    const structures: AtlasStructureShape[] = atlasInfo.atlas.structures.map((n: any) => {
        const s = {...n};

        delete s.id;
        s.updatedAt = null;
        s.createdAt = when;

        return s;
    });

    return [atlas, structures];
}

function loadNodeStructures(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "nodeStructures.json");

    const fileData = fs.readFileSync(fixtureDataPath, "utf-8");

    const areas = JSON.parse(fileData);

    return areas.map((a: any) => {
        a.updatedAt = null;
        a.createdAt = when;

        return a;
    });
}

function loadNeuronStructures(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "neuronStructures.json");

    const fileData = fs.readFileSync(fixtureDataPath, "utf-8");

    const areas = JSON.parse(fileData);

    return areas.map((a: any) => {
        a.updatedAt = null;
        a.createdAt = when;

        return a;
    });
}
