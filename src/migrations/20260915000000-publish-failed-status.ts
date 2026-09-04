import {QueryInterface, QueryTypes} from "sequelize";

import {AtlasReconstructionTableName, ReconstructionTableName} from "../models/tableNames";

/**
 * PublishFailed gives a failed search index its own parent status.  Before this, such a reconstruction was left at
 * Publishing, indistinguishable from one indexing normally, so any row already in that state has to be moved or it
 * stays invisible for as long as it exists.
 *
 * The child is the discriminator: Publishing with a child at FailedSearchIndexing is exactly the state the new status
 * names, and Publishing with a child anywhere else is a publish still in flight, which must be left alone.  The
 * literal status numbers are what migrations in this tree use.  Raw SQL bypasses Sequelize's paranoid scope, hence the
 * explicit deletedAt tests - both tables are paranoid.
 */
const failQuery = `
    WITH moved AS (
        UPDATE "${ReconstructionTableName}" AS parent
        SET "status" = 1100                                 -- ReconstructionStatus.PublishFailed
        FROM "${AtlasReconstructionTableName}" child
        WHERE child."reconstructionId" = parent.id
          AND parent."status" = 900                         -- ReconstructionStatus.Publishing
          AND child."status" = 740                          -- AtlasReconstructionStatus.FailedSearchIndexing
          AND parent."deletedAt" IS NULL
          AND child."deletedAt" IS NULL
        RETURNING parent.id
    )
    SELECT (SELECT count(*)::int FROM moved) AS parents;
`;

/**
 * Approximate, in the same way the neighbouring migration's down is: it cannot distinguish rows this migration moved
 * from rows the indexing phase has since put at PublishFailed.  Both are the same state under the old scheme, so
 * moving all of them back is the correct reversal.
 */
const restoreQuery = `
    WITH moved AS (
        UPDATE "${ReconstructionTableName}" AS parent
        SET "status" = 900                                  -- ReconstructionStatus.Publishing
        WHERE parent."status" = 1100                        -- ReconstructionStatus.PublishFailed
          AND parent."deletedAt" IS NULL
        RETURNING parent.id
    )
    SELECT (SELECT count(*)::int FROM moved) AS parents;
`;

type MoveCounts = {
    parents: number;
}

// SELECT rather than UPDATE so the count comes back and can be reported.
const runMove = async (queryInterface: QueryInterface, query: string): Promise<MoveCounts> => {
    const [counts] = await queryInterface.sequelize.query<MoveCounts>(query, {type: QueryTypes.SELECT});

    return counts;
};

export = {
    up: async (queryInterface: QueryInterface) => {
        const counts = await runMove(queryInterface, failQuery);

        console.log(`   moved ${counts.parents} reconstruction(s) to PublishFailed`);
    },

    down: async (queryInterface: QueryInterface) => {
        const counts = await runMove(queryInterface, restoreQuery);

        console.log(`   moved ${counts.parents} reconstruction(s) back to Publishing`);
    }
};
