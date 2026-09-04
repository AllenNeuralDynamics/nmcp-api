import {QueryInterface, QueryTypes} from "sequelize";

import {AtlasReconstructionTableName, NeuronTableName, ReconstructionTableName} from "../models/tableNames";

/**
 * DOI assignment became a pipeline phase of its own, so a child already sitting at ReadyToPublish never ran it and
 * publish - which now only asserts the DOIs exist - would refuse it.
 *
 * Child and parent move in one statement because they cannot be allowed to diverge: a child reached ReadyToPublish
 * through the same call that advanced its parent, and rewinding only the child would leave the parent advertising
 * readiness, feed it to publishAll("ALL") as a bulk-publish error, and then hand onAtlasReconstructionStatusChanged a
 * parent already at ReadyToPublish when the phase completed - which it treats as unexpected and skips, so the
 * transition would never be recorded.
 *
 * The literal status numbers are what migrations in this tree use; note that 600 means ReadyToPublish on the child and
 * WaitingForAtlasReconstruction on the parent.  Raw SQL bypasses Sequelize's paranoid scope, hence the explicit
 * deletedAt tests - both tables are paranoid.
 */
const rewindQuery = `
    WITH moved AS (
        UPDATE "${AtlasReconstructionTableName}" AS target
        SET "status" = 585                                  -- AtlasReconstructionStatus.PendingDoiAssignment
        FROM "${ReconstructionTableName}" reconstruction
             JOIN "${NeuronTableName}" neuron ON neuron.id = reconstruction."neuronId"
        WHERE target."reconstructionId" = reconstruction.id
          AND target."status" = 600                         -- AtlasReconstructionStatus.ReadyToPublish
          AND target."deletedAt" IS NULL
          AND reconstruction."deletedAt" IS NULL
          AND (target."doi" IS NULL OR target."doi" = '' OR neuron."canonicalDoi" IS NULL OR neuron."canonicalDoi" = '')
        RETURNING target.id, target."reconstructionId"
    ),
    rewound AS (
        UPDATE "${ReconstructionTableName}" AS parent
        SET "status" = 600                                  -- ReconstructionStatus.WaitingForAtlasReconstruction
        FROM moved
        WHERE parent.id = moved."reconstructionId"
          AND parent."status" = 700                         -- ReconstructionStatus.ReadyToPublish
        RETURNING parent.id
    )
    SELECT (SELECT count(*)::int FROM moved) AS children, (SELECT count(*)::int FROM rewound) AS parents;
`;

/**
 * Approximate: it cannot distinguish rows this migration moved from rows the phase has since put at
 * PendingDoiAssignment, which is why the up is written to be safely re-runnable.
 */
const restoreQuery = `
    WITH moved AS (
        UPDATE "${AtlasReconstructionTableName}" AS target
        SET "status" = 600                                  -- AtlasReconstructionStatus.ReadyToPublish
        WHERE target."status" = 585                         -- AtlasReconstructionStatus.PendingDoiAssignment
          AND target."deletedAt" IS NULL
        RETURNING target.id, target."reconstructionId"
    ),
    rewound AS (
        UPDATE "${ReconstructionTableName}" AS parent
        SET "status" = 700                                  -- ReconstructionStatus.ReadyToPublish
        FROM moved
        WHERE parent.id = moved."reconstructionId"
          AND parent."status" = 600                         -- ReconstructionStatus.WaitingForAtlasReconstruction
        RETURNING parent.id
    )
    SELECT (SELECT count(*)::int FROM moved) AS children, (SELECT count(*)::int FROM rewound) AS parents;
`;

type RewindCounts = {
    children: number;
    parents: number;
}

// SELECT rather than UPDATE so the counts come back and both can be reported.
const runRewind = async (queryInterface: QueryInterface, query: string): Promise<RewindCounts> => {
    const [counts] = await queryInterface.sequelize.query<RewindCounts>(query, {type: QueryTypes.SELECT});

    return counts;
};

export = {
    up: async (queryInterface: QueryInterface) => {
        const counts = await runRewind(queryInterface, rewindQuery);

        console.log(`   moved ${counts.children} atlas reconstruction(s) to PendingDoiAssignment`);
        console.log(`   rewound ${counts.parents} reconstruction(s) to WaitingForAtlasReconstruction`);
    },

    down: async (queryInterface: QueryInterface) => {
        const counts = await runRewind(queryInterface, restoreQuery);

        console.log(`   moved ${counts.children} atlas reconstruction(s) to ReadyToPublish`);
        console.log(`   advanced ${counts.parents} reconstruction(s) to ReadyToPublish`);
    }
};
