import {ConnectionError, TimeoutError} from "sequelize";

/**
 * What a worker phase reports about one item.  Three values rather than a boolean because the two ways of not
 * finishing call for opposite responses from the worker: an unanswering external service means stop calling it,
 * and a database blip means carry on.  Collapsing them is what makes a Postgres hiccup look like a StandardMorph
 * or DataCite outage and suppress calls to a service that is perfectly healthy.
 */
export enum PhaseOutcome {
    // Advanced, or Failed... recorded with its reason.  The only value that counts towards a full batch.
    Handled = 0,
    // The external dependency did not answer.  Claim released; the worker backs that service off.
    ServiceUnavailable = 1,
    // A local transient - see isTransientDatabaseError.  Claim released; no backoff, next item.
    Released = 2
}

// Postgres classes that say "try again", not "this item is broken": serialization_failure and deadlock_detected.
// Both are reachable here - assignDois and publish take LOCK.UPDATE on the same neuron row, so two siblings of one
// neuron can deadlock - and recording either as a phase failure would demand a human for a retry that would work.
const retryableSqlStates = ["40001", "40P01"];

/**
 * A phase failure that says nothing about the item: the database was unreachable, the statement timed out, or the
 * transaction lost a race and can simply be run again.  Anything else - a null atlas, a constraint violation, a
 * bug - is a property of this item and will fail again however many times it is tried.
 */
export function isTransientDatabaseError(error: unknown): boolean {
    if (error instanceof ConnectionError || error instanceof TimeoutError) {
        return true;
    }

    const sqlState = (error as any)?.original?.code ?? (error as any)?.parent?.code;

    return retryableSqlStates.includes(sqlState);
}

/**
 * Full detail, stack included.  For debug() only - never for a value that is stored or returned by the API.
 */
export function failureText(error: unknown): string {
    return error instanceof Error ? error.stack ?? error.message : String(error);
}

/**
 * What an unexpected exception is allowed to say on the row, and therefore to anyone who can read the GraphQL
 * schema.  The class name is bounded and leaks no paths, table names or query text; failedAt and the event log
 * are what tie the row to the debug line carrying the rest.
 */
export function phaseFailureMessage(phase: string, error: unknown): string {
    const kind = error instanceof Error ? error.constructor.name : typeof error;

    return `unexpected ${kind} during ${phase}`;
}
