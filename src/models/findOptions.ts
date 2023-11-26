import {FindOptions, Op} from "sequelize";

import {Injection} from "./injection";
import {Neuron} from "./neuron";
import {Sample} from "./sample"
import {EntityQueryInput} from "./baseModel";

export type WithCompartmentQueryInput = {
    brainAreaIds?: string[];
}

export type WithMouseStrainQueryInput = {
    mouseStrainIds?: string[];
}

export type WithInjectionVirusQueryInput = {
    injectionVirusIds?: string[];
}

export type WithFluorophoreQueryInput = {
    fluorophoreIds?: string[];
}

export type WithSamplesQueryInput = {
    sampleIds?: string[];
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

export function optionsIncludeSampleIds(input: WithSamplesQueryInput, options: FindOptions): FindOptions {
    if (input && input.sampleIds && input.sampleIds.length > 0) {
        // @ts-ignore
        options.include.push({
            model: Sample,
            where: {id: {[Op.in]: input.sampleIds}}
        });
    }

    return options;
}

function optionsWherePropertyIds(input: any, propertyName: string, options: FindOptions): FindOptions {
    const fieldName = `${propertyName}s`;

    const outOptions = options || {where: null, include: []};

    if (input && input[fieldName] && input[fieldName].length > 0) {
        outOptions.where = Object.assign(outOptions.where || {}, {[propertyName]: {[Op.in]: input[fieldName]}});
    }

    return outOptions;
}

export function optionsWhereIds(input: EntityQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "id", options);
}

export function optionsWhereMouseStrainIds(input: WithMouseStrainQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "mouseStrainId", options);
}

export function optionsWhereSampleIds(input: WithSamplesQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "sampleId", options);
}

export function optionsWhereInjectionIds(input: WithInjectionsQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "injectionId", options);
}

export function optionsWhereInjectionVirusIds(input: WithInjectionVirusQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "injectionVirusId", options);
}

export function optionsWhereFluorophoreIds(input: WithFluorophoreQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "fluorophoreId", options);
}

export function optionsWhereCompartmentIds(input: WithCompartmentQueryInput, options: FindOptions = null): FindOptions {
    return optionsWherePropertyIds(input, "brainAreaId", options);
}