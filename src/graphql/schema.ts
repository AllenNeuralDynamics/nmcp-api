import {makeExecutableSchema} from '@graphql-tools/schema';
import {mapSchema} from '@graphql-tools/utils';
import {GraphQLSchema} from "graphql/type";
import {typeDefinitions} from "./typeDefinitions";
import {merge} from "lodash";
import {openResolvers} from "./openResolvers";
import {secureResolvers} from "./secureResolvers";
import {internalResolvers} from "./internalResolvers";

function hiddenDirectiveTransformer(schema: GraphQLSchema, directiveName: string) {
    return mapSchema(schema, {});
}

export function createSchema() {
    const schema = makeExecutableSchema({
        typeDefs: typeDefinitions,
        resolvers: merge(openResolvers, secureResolvers, internalResolvers)
    });

    return schema; // hiddenDirectiveTransformer(schema, "hidden");
}
