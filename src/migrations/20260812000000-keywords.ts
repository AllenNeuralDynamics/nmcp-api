import {QueryInterface, QueryTypes} from "sequelize";

import {NeuronTableName, SpecimenTableName} from "../models/tableNames";

const keywordTableNames = [NeuronTableName, SpecimenTableName];

/**
 * Anything other than a list or a bare string has no keyword text worth recovering, so refuse rather than
 * quietly replace it with an empty list.
 */
const unexpectedShapeQuery = (tableName: string) => `
    SELECT count(*)::int AS count
    FROM "${tableName}"
    WHERE "keywords" IS NOT NULL
      AND jsonb_typeof("keywords") NOT IN ('array', 'string');
`;

/**
 * Mirrors normalizeKeywords() in util/keywords.ts - trim, drop empties, and drop duplicates without regard to
 * case keeping the first occurrence.  No separator is applied: an element containing a comma is one keyword,
 * matching what the API now stores.  Ordinality carries the original ordering through the unnest so the
 * stored order survives.  A bare string is treated as a single element, which is how a scalar would have to
 * be interpreted, and a null becomes the empty list the model expects.
 */
const normalizeQuery = (tableName: string) => `
    WITH source AS (
        SELECT entity.id,
               CASE jsonb_typeof(entity."keywords")
                   WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(entity."keywords"))
                   WHEN 'string' THEN ARRAY[entity."keywords" #>> '{}']
                   ELSE ARRAY[]::text[]
               END AS entries
        FROM "${tableName}" entity
    ),
    exploded AS (
        SELECT DISTINCT ON (source.id, lower(btrim(elem.value)))
               source.id,
               btrim(elem.value) AS keyword,
               elem.ordinality
        FROM source
             CROSS JOIN LATERAL unnest(source.entries) WITH ORDINALITY AS elem(value, ordinality)
        WHERE btrim(elem.value) <> ''
        ORDER BY source.id, lower(btrim(elem.value)), elem.ordinality
    ),
    normalized AS (
        SELECT source.id,
               COALESCE(aggregated.keywords, '[]'::jsonb) AS keywords
        FROM source
             LEFT JOIN (
                 SELECT exploded.id,
                        jsonb_agg(exploded.keyword ORDER BY exploded.ordinality) AS keywords
                 FROM exploded
                 GROUP BY exploded.id
             ) aggregated ON aggregated.id = source.id
    )
    UPDATE "${tableName}" AS target
    SET "keywords" = normalized.keywords
    FROM normalized
    WHERE target.id = normalized.id
      AND target."keywords" IS DISTINCT FROM normalized.keywords
    RETURNING target.id;
`;

/**
 * Raw SQL rather than changeColumn so that only nullability is touched.  Sequelize renders a JSONB
 * defaultValue of [] as the invalid "DEFAULT ARRAY[]" on the alter path, and the column already carries the
 * correct '[]'::jsonb default from the table's original migration.
 */
const setNotNullQuery = (tableName: string) => `
    ALTER TABLE "${tableName}" ALTER COLUMN "keywords" SET NOT NULL;
`;

const dropNotNullQuery = (tableName: string) => `
    ALTER TABLE "${tableName}" ALTER COLUMN "keywords" DROP NOT NULL;
`;

const migrateTable = async (queryInterface: QueryInterface, tableName: string): Promise<void> => {
    const [unexpected] = await queryInterface.sequelize.query<{ count: number }>(unexpectedShapeQuery(tableName), {type: QueryTypes.SELECT});

    if (unexpected.count > 0) {
        throw new Error(`${unexpected.count} ${tableName} row(s) have a keywords value that is neither a list nor a string - resolve these before migrating.`);
    }

    // SELECT rather than UPDATE so that the RETURNING rows come back and the affected count can be reported.
    const updated = await queryInterface.sequelize.query<{ id: string }>(normalizeQuery(tableName), {type: QueryTypes.SELECT});

    console.log(`   normalized keywords on ${updated.length} ${tableName} row(s)`);

    await queryInterface.sequelize.query(setNotNullQuery(tableName));
};

export = {
    up: async (queryInterface: QueryInterface) => {
        for (const tableName of keywordTableNames) {
            await migrateTable(queryInterface, tableName);
        }
    },

    // Only the nullability is reversible - the normalized values have no record of what they were before.
    down: async (queryInterface: QueryInterface) => {
        for (const tableName of keywordTableNames) {
            await queryInterface.sequelize.query(dropNotNullQuery(tableName));
        }
    }
};
