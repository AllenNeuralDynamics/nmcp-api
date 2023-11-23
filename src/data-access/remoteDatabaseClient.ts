import * as path from "path";
import * as fs from "fs";
import uuid = require("uuid");
import {parse} from "csv/lib/sync";
import {Sequelize, QueryInterface, Options, Op} from "sequelize";

const debug = require("debug")("mnb:sample-api:database-connector");

import {SequelizeOptions} from "../options/coreServicesOptions";
import {ServiceOptions} from "../options/serviceOptions";
import {BrainArea, IBrainArea} from "../models/brainArea";
import {Neuron} from "../models/neuron";
import {Fluorophore} from "../models/fluorophore";
import {InjectionVirus} from "../models/injectionVirus";
import {MouseStrain} from "../models/mouseStrain";

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
        await this.refreshDoi();
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
            debug("seeding brain areas");

            const chunkSize = 250;

            const allExisting = (await BrainArea.findAll({attributes: ["id"]}));
            const allExistingId = allExisting.map(b => b.id);

            const items = loadAllenBrainAreas(when);

            const existing = items.filter(i => allExistingId.includes(i.id));
            const newItems = items.filter(i => !allExistingId.includes(i.id));

            const updates = existing.map(item => {
                const o = allExisting.find(e => e.id == item.id);
                return o.update(item);
            });

            await Promise.all(updates);

            while (newItems.length > chunkSize) {
                const chunk = newItems.splice(0, chunkSize);
                await queryInterface.bulkInsert("BrainAreas", chunk, {});
            }

            if (newItems.length > 0) {
                await queryInterface.bulkInsert("BrainAreas", newItems, {});
            }
        } else {
            debug("skipping brain area seed");
        }

        count = await Fluorophore.count();
        if (count == 0) {
            debug("seeding brain fluorophores");
            await queryInterface.bulkInsert("Fluorophores", loadFluorophores(when), {});
        } else {
            debug("skipping fluorophore seed");
        }

        count = await MouseStrain.count();
        if (count == 0) {
            debug("seeding brain mouse strains");
            await queryInterface.bulkInsert("MouseStrains", loadMouseStrains(when), {});
        } else {
            debug("skipping mouse strain seed");
        }

        count = await InjectionVirus.count();
        if (count == 0) {
            debug("seeding brain injection viruses");
            await queryInterface.bulkInsert("InjectionViruses", loadInjectionViruses(when), {});
        } else {
            debug("skipping injection virus seed");
        }

        debug("seed complete");
    }

    private async refreshDoi() {
        try {
            const c = await Neuron.count();

            if (c === 0) {
                debug(`skipping doi refresh - empty database`);
                return;
            }

            debug("refreshing neuron doi");

            const filename = path.join(ServiceOptions.fixturePath, "mouselight-neuron-doi.csv");

            const data = fs.readFileSync(filename);

            const lines = parse(data);

            debug(`refresh ${lines.length} entries`);

            await this.applyDoi(lines);

            debug(`refresh complete`);
        } catch (err) {
            debug(err);
        }
    }

    private async applyDoi(lines: any) {
        return await lines.map(async (line: any) => {
            const neuron = await Neuron.findOne({where: {idString: line[0]}});

            if (neuron && (!neuron.doi || neuron.doi.length === 0)) {
                await neuron.update({doi: line[1]});
            }
        });
    }
}

function loadMouseStrains(when: Date) {
    return [{id: "e3fda807-f57c-4b14-b4fd-0accfd668017", name: "C57BL/6J", updatedAt: when, createdAt: when}];
}

function loadInjectionViruses(when: Date) {
    return [{
        id: "7c792530-b1b0-47d3-b4c2-c7089523a78d",
        name: "AAV2/1.FLEX-eGFP",
        updatedAt: when,
        createdAt: when
    }, {
        id: uuid.v4(),
        name: "75b6241f-6c5c-4415-a329-e18862e4cc9e",
        updatedAt: when,
        createdAt: when
    }];
}

function loadFluorophores(when: Date) {
    return [{
        id: "47fc1eff-a7e0-4a56-9e4d-5797f8d28d5f",
        name: "eGFP",
        updatedAt: when,
        createdAt: when
    }, {
        id: "48fd3c4e-d0ad-4ef7-8a6d-b62248930ddf",
        name: "tdTomato",
        updatedAt: when,
        createdAt: when
    }];
}

function loadAllenBrainAreas(when: Date): IBrainArea[] {
    const fixtureDataPath = path.join(ServiceOptions.fixturePath, "compartments.json");

    const fileData = fs.readFileSync(fixtureDataPath, {encoding: "UTF-8"});

    const areas = JSON.parse(fileData);

    return areas.map(a => {
        a.updatedAt = when;
        a.createdAt = a.createdAt ?? when;

        return a;
    });
}
