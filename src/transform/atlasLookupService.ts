import {NrrdFile} from "../io/nrrdFile";
import {ServiceOptions} from "../options/serviceOptions";
import {AtlasStructure} from "../models/atlasStructure";

const debug = require("debug")("nmcp:api:transform:atlasLookupService");

export type AtlasLocation = {
    x: number;
    y: number;
    z: number;
}

let isInitialized = false;

const nrrdContent = new NrrdFile(ServiceOptions.ccfv30OntologyPath);

function initAtlasLookupService() {
    if (isInitialized) {
        return;
    }

    nrrdContent.init();

    debug(`brain lookup extents (nrrd30 order) ${nrrdContent.size[0]} ${nrrdContent.size[1]} ${nrrdContent.size[2]}`);

    isInitialized = true;
}

export function findBrainStructure(location: AtlasLocation): string {
    return findBrainStructures([location])[0]
}

export function findBrainStructures(locations: AtlasLocation[]): string[] {
    initAtlasLookupService();

    return locations.map((location: AtlasLocation) => {
        if (location.x < 0 || location.y < 0 || location.z < 0) {
            return null;
        }

        const transformedLocation = [Math.ceil(location.x / 10), Math.ceil(location.y / 10), Math.ceil(location.z / 10)];

        const structureId = nrrdContent.findStructureId(transformedLocation[0], transformedLocation[1], transformedLocation[2]);

        return structureId ? AtlasStructure.getFromStructureId(structureId)?.id ?? null : null;
    });
}
