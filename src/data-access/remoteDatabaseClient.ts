import * as path from "path";
import * as fs from "fs";
import {Sequelize, QueryInterface, Options} from "sequelize";

const debug = require("debug")("mnb:sample-api:database-connector");

import {SequelizeOptions} from "../options/coreServicesOptions";
import {ServiceOptions} from "../options/serviceOptions";
import {BrainArea, IBrainArea} from "../models/brainArea";
import {MouseStrain} from "../models/mouseStrain";
import {Sample} from "../models/sample";
import {Neuron} from "../models/neuron";
import {StructureIdentifier} from "../models/structureIdentifier";
import {TracingStructure} from "../models/tracingStructure";
import {loadTracingCache} from "../rawquery/tracingQueryMiddleware";
import {Reconstruction} from "../models/reconstruction";

export class RemoteDatabaseClient {
    public static async Start(prepareSearchContents = false, enableLog: boolean = false, options: Options = SequelizeOptions): Promise<RemoteDatabaseClient> {
        const client = new RemoteDatabaseClient(options);
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

        await this.authenticate("sample");

        if (prepareSearchContents) {
            await this.seedIfRequired();

            await this.prepareSearchContents();
        }
    }

    private createConnection(options: Options) {
        this._connection = new Sequelize(options.database, options.username, options.password, options);

        this.loadModels(path.normalize(path.join(__dirname, "..", "models")));
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

    private loadModels(modelLocation: string) {
        const modules = [];

        fs.readdirSync(modelLocation).filter(file => {
            return (file.indexOf(".") !== 0) && (file.slice(-3) === ".js");
        }).forEach(file => {
            let modelModule = require(path.join(modelLocation, file.slice(0, -3)));

            if (modelModule.modelInit != null) {
                modelModule.modelInit(this._connection);
                modules.push(modelModule);
            }
        });

        modules.forEach(modelModule => {
            if (modelModule.modelAssociate != null) {
                modelModule.modelAssociate();
            }
        });
    }

    private async seedIfRequired() {
        const queryInterface: QueryInterface = this._connection.getQueryInterface();

        const when = new Date();

        try {
            let count = await BrainArea.count();

            if (count < 1327) {
                this.log("seeding brain structures");

                const chunkSize = 250;

                const allExisting = (await BrainArea.findAll({attributes: ["id"]}));
                const allExistingId = allExisting.map(b => b.id);

                const items = loadBrainStructures(when);

                const existing = items.filter(i => allExistingId.includes(i.id));
                const newItems = items.filter(i => !allExistingId.includes(i.id));

                const updates = existing.map(item => {
                    const o = allExisting.find(e => e.id == item.id);
                    return o.update(item);
                });

                await Promise.all(updates);

                while (newItems.length > chunkSize) {
                    const chunk = newItems.splice(0, chunkSize);
                    await queryInterface.bulkInsert("BrainStructure", chunk, {});
                }

                if (newItems.length > 0) {
                    await queryInterface.bulkInsert("BrainStructure", newItems, {});
                }
            } else {
                this.log("skipping brain structure seed");
            }

            count = await MouseStrain.count();
            if (count == 0) {
                this.log("seeding mouse strains");
                await queryInterface.bulkInsert("Genotype", loadMouseStrains(when), {});
            } else {
                this.log("skipping mouse strain seed");
            }

            count = await StructureIdentifier.count();
            if (count == 0) {
                this.log("seeding structure identifiers");
                await queryInterface.bulkInsert("StructureIdentifier", loadStructureIdentifiers(when), {});
            } else {
                this.log("skipping structure identifier seed");
            }

            count = await TracingStructure.count();
            if (count == 0) {
                this.log("seeding tracing structures");
                await queryInterface.bulkInsert("TracingStructure", loadTracingStructures(when), {});
            } else {
                this.log("skipping structure seed");
            }

            if (ServiceOptions.seedUserItems) {
                this.log("seeding user-defined items");

                count = await Sample.count();

                if (count == 0) {
                    this.log("seeding samples");
                    await queryInterface.bulkInsert("Sample", loadSamples(when), {});
                } else {
                    this.log("skipping sample seed");
                }

                count = await Neuron.count();

                if (count == 0) {
                    this.log("seeding neurons");
                    await queryInterface.bulkInsert("Neuron", loadNeurons(when), {});
                } else {
                    this.log("skipping neuron seed");
                }
            }
        } catch (err) {
            this.log(err);
        }

        this.log("seed complete");
    }

    private async prepareSearchContents() {
        this.log(`preparing search contents`);

        await BrainArea.loadCompartmentCache();

        await Neuron.loadNeuronCache();

        await Reconstruction.loadReconstructionCache();

        await loadTracingCache();
    }

    private log(message: any) {
        if (this._enableLog) {
            debug(`${message}`);
        }
    }
}

function loadBrainStructures(when: Date): IBrainArea[] {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "brainStructures.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}

function loadMouseStrains(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "genotypes.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}

function loadStructureIdentifiers(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "structureIdentifiers.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}

function loadTracingStructures(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "tracingStructures.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}

function loadSamples(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "samples.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}

function loadNeurons(when: Date) {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "neurons.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}
