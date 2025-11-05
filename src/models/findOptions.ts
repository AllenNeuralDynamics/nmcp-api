import {FindOptions, Op} from "sequelize";

import {Neuron} from "./neuron";
import {Specimen} from "./specimen";
import {Injection} from "./injection";
import {EntityQueryInput} from "./baseModel";

export type WithAtlasStructureQueryInput = {
    atlasStructureIds?: string[];
}

export type WithGenotypeQueryInput = {
    genotypeId?: string[];
}

export type WithSpecimensQueryInput = {
    specimenIds?: string[];
}

export type WithInjectionsQueryInput = {
    injectionIds?: string[];
}

export type WithNeuronsQueryInput = {
    neuronIds?: string[];
}

export function optionsIncludeInjectionIds(input: WithInjectionsQueryInput, options: FindOptions): FindOptions {
    if (input && input.injectionIds && input.injectionIds.length > 0) {
        // @ts-ignore
        options.include.push({
            model: Injection,
            where: {id: {[Op.in]: input.injectionIds}}
        });
    }

    return options;
}

export function optionsIncludeNeuronIds(input: WithNeuronsQueryInput, options: FindOptions): FindOptions {
    if (input && input.neuronIds && input.neuronIds.length > 0) {
        // @ts-ignore
        options.include.push({
            model: Neuron,
            where: {id: {[Op.in]: input.neuronIds}}
        });
    }

    return options;
}

export function optionsIncludeSpecimenIds(input: WithSpecimensQueryInput, options: FindOptions): FindOptions {
    if (input && input.specimenIds && input.specimenIds.length > 0) {
        // @ts-ignore
        options.include.push({
            model: Specimen,
            where: {id: {[Op.in]: input.specimenIds}}
        });
    }

    return options;
}

function optionsWherePropertyIds(input: any, propertyName: string, options: FindOptions): FindOptions {
    const fieldName = `${propertyName}s`;

    const outOptions = options ?? {where: null, include: []};

    if (input && input[fieldName] && input[fieldName].length > 0) {
        outOptions.where = Object.assign(outOptions.where ?? {}, {[propertyName]: {[Op.in]: input[fieldName]}});
    }

    return outOptions;
}

export function optionsWhereIds(input: EntityQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "id", options);
}

export function optionsWhereGenotypeIds(input: WithGenotypeQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "genotypeId", options);
}

export function optionsWhereSpecimenIds(input: WithSpecimensQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "specimenId", options);
}

export function optionsWhereAtlasStructureIds(input: WithAtlasStructureQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "atlasStructureId", options);
}
