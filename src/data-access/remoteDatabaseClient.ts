import * as path from "path";
import * as fs from "fs";
import uuid = require("uuid");
import {parse} from "csv/lib/sync";
import {Sequelize, QueryInterface, Options, Op} from "sequelize";

const debug = require("debug")("mnb:sample-api:database-connector");

import {SequelizeOptions} from "../options/coreServicesOptions";
import {ServiceOptions} from "../options/serviceOptions";
import {BrainArea, IBrainArea} from "../models/brainArea";
import {MouseStrain} from "../models/mouseStrain";
import {Sample} from "../models/sample";
import {Neuron} from "../models/neuron";
import {StructureIdentifier} from "../models/structureIdentifier";
import {TracingStructure} from "../models/tracingStructure";

export class RemoteDatabaseClient {
    public static async Start(options: Options = SequelizeOptions): Promise<RemoteDatabaseClient> {
        const client = new RemoteDatabaseClient(options);
        await client.start();
        return client;
    }

    private _connection: Sequelize;
    private readonly _options: Options;

    private constructor(options: Options) {
        this._options = options;
    }

    private async start() {
        this.createConnection(this._options);
        await this.authenticate("sample");
        await this.seedIfRequired();
    }

    private createConnection(options: Options) {
        this._connection = new Sequelize(options.database, options.username, options.password, options);

        this.loadModels(path.normalize(path.join(__dirname, "..", "models")));
    }

    private async authenticate(name: string) {
        try {
            await this._connection.authenticate();

            debug(`successful database connection: ${name}`);

        } catch (err) {
            if (err.name === "SequelizeConnectionRefusedError") {
                debug(`failed database connection: ${name} (connection refused - is it running?) - delaying 5 seconds`);
            } else {
                debug(`failed database connection: ${name} - delaying 5 seconds`);
                debug(err);
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

        let count = await BrainArea.count();

        if (count < 1327) {
            debug("seeding brain structures");

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
            debug("skipping brain structure seed");
        }

        count = await MouseStrain.count();
        if (count == 0) {
            debug("seeding mouse strains");
            await queryInterface.bulkInsert("Genotype", loadMouseStrains(when), {});
        } else {
            debug("skipping mouse strain seed");
        }

        count = await StructureIdentifier.count();
        if (count == 0) {
            debug("seeding structure identifiers");
            await queryInterface.bulkInsert("StructureIdentifier", loadStructureIdentifiers(when), {});
        } else {
            debug("skipping structure identifier seed");
        }

        count = await TracingStructure.count();
        if (count == 0) {
            debug("seeding tracing structures");
            await queryInterface.bulkInsert("TracingStructure", loadTracingStructures(when), {});
        } else {
            debug("skipping structure seed");
        }

        if (ServiceOptions.seedUserItems) {
            debug("seeding user-defined items");

            count = await Sample.count();

            if (count == 0) {
                debug("seeding samples");
                await queryInterface.bulkInsert("Sample", loadSamples(when), {});
            } else {
                debug("skipping sample seed");
            }

            count = await Neuron.count();

            if (count == 0) {
                debug("seeding neurons");
                await queryInterface.bulkInsert("Neuron", loadNeurons(when), {});
            } else {
                debug("skipping neuron seed");
            }
        }

        debug("seed complete");
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
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "mouseStrains.json");

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