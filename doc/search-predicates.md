# Search Predicates Specification

The `searchNeurons` query accepts a `SearchContext` containing one or more predicates. Each predicate filters published neuron data in the SearchIndex and returns a set of matching neuron IDs. Multiple predicates are composed together using boolean logic to produce the final result set.

## SearchContext

| Field | Type | Description |
|---|---|---|
| `nonce` | `String` | Client-provided identifier echoed back in the response for correlation. |
| `collectionIds` | `[String!]` | Restricts all predicates to neurons in these collections. Empty array means no restriction. |
| `predicates` | `[Predicate!]` | One or more predicates. If omitted or empty, a default predicate is used that matches all published neurons. |

## Predicate Composition

Each predicate has a `composition` field that controls how its result set is combined with the accumulated result of all preceding predicates.

| Value | Name | Operation | Description |
|---|---|---|---|
| 1 | AND | Intersection | Keep only neurons present in both the accumulated set and this predicate's results. |
| 2 | OR | Union | Add this predicate's results to the accumulated set. |
| 3 | NOT | Difference | Remove this predicate's results from the accumulated set. |

The first predicate's `composition` value is ignored; its results always form the initial set.

Predicates are evaluated left to right. Each predicate runs independently against the SearchIndex, producing a set of neuron IDs. The sets are then combined sequentially using the composition operator.

**Example with three predicates:**

1. Predicate A produces `{N1, N2, N3}`
2. Predicate B (OR) produces `{N3, N4}` &rarr; accumulated = `{N1, N2, N3, N4}`
3. Predicate C (NOT) produces `{N2, N4}` &rarr; final = `{N1, N3}`

## Collection Filtering

When `collectionIds` is non-empty, every predicate (regardless of type) restricts its SearchIndex query to rows whose `collectionId` is in the provided list. This filter is applied at the database level before any other filtering.

## Node Count Filtering (AnatomicalRegion and CustomRegion only)

AnatomicalRegion and CustomRegion predicates apply an additional node count threshold filter using these fields:

| Field | Type | Description |
|---|---|---|
| `operatorId` | `String` | ID of a comparison operator (=, >, <, etc.). If omitted, defaults to `>` with `amount` 0 (i.e., at least one node). |
| `amount` | `Float` | The threshold value for the comparison. |
| `nodeStructureId` | `String` | Which node type to count. Controls which SearchIndex column is compared. |

Available operators: `=`, `!=`, `>`, `<`, `>=`, `<=`.

**Column selection based on `nodeStructureId`:**

| nodeStructureId | Column compared |
|---|---|
| Empty or omitted | `nodeCount` (total across all node types) |
| Specified | The column corresponding to that node type |

**Node type to column mapping:**

| Node Type | SearchIndex Column |
|---|---|
| Fork point | `branchCount` |
| End point | `endCount` |
| Undefined / path | `pathCount` |
| Soma, axon, dendrite | No count column (filter is not applied) |

IdOrDoi predicates do not apply node count filtering.

---

## PredicateType: AnatomicalRegion

Finds neurons that have morphological data in specified brain regions, optionally filtered by neuron compartment type and node count thresholds.

### Inputs

| Field | Type | Description |
|---|---|---|
| `atlasStructureIds` | `[String!]` | Brain region IDs to search. Each selected region implicitly includes all of its descendant regions in the atlas hierarchy. If empty, or if only the whole-brain structure is selected, no region filter is applied (equivalent to searching the entire brain). |
| `neuronStructureId` | `String` | Neuron compartment type ID (soma, axon, dendrite). If provided, only SearchIndex rows for that compartment are matched. If empty, all compartment types are included. |
| `nodeStructureId` | `String` | See Node Count Filtering above. |
| `operatorId` | `String` | See Node Count Filtering above. |
| `amount` | `Float` | See Node Count Filtering above. |

### Behavior

1. Query SearchIndex rows filtered by:
   - `atlasStructureId` in the expanded set of selected regions and their descendants (unless whole-brain or empty).
   - `neuronStructureId` matching the single selected compartment (if exactly one specified).
   - Node count column satisfying the operator/amount threshold.
   - `collectionId` restriction (if any).
2. Collect the distinct `neuronId` values from the matched rows.

### Notes

- **Soma as neuron structure**: When `neuronStructureId` selects soma, the search is effectively a presence check — does the neuron's soma reside in one of the specified atlas structures? The operator and amount are meaningless in this case because a soma is a single point: a SearchIndex row for the soma compartment only exists when the soma is located in that atlas structure, and it always has exactly one node.
- Selecting the whole-brain structure is treated as "no region filter" rather than literally filtering to that single ID. This ensures neurons with nodes outside the atlas ontology (e.g., soma-only entries) are not excluded.
- The atlas hierarchy expansion means selecting a parent region like "Isocortex" will match neurons in any child region (e.g., "MOp", "SSp", etc.).

---

## PredicateType: CustomRegion

Finds neurons whose soma falls within a spherical region in atlas coordinate space. This predicate does not use `neuronStructureId`, `nodeStructureId`, `operatorId`, or `amount` — it is purely a spatial filter on soma position.

### Inputs

| Field | Type | Description |
|---|---|---|
| `arbCenter` | `{x, y, z}` | Center point of the sphere in atlas coordinates (micrometers). |
| `arbSize` | `Float` | Radius of the sphere in micrometers. |

### Behavior

1. Query all SearchIndex rows (filtered only by collection, if specified).
2. For each matched row, compute the 3D Euclidean distance between the row's soma position `(somaX, somaY, somaZ)` and the provided `arbCenter`:
   ```
   distance = sqrt((arbCenter.x - somaX)^2 + (arbCenter.y - somaY)^2 + (arbCenter.z - somaZ)^2)
   ```
3. Keep only rows where `distance <= arbSize`.
4. Collect the distinct `neuronId` values from the remaining rows.

### Notes

- The distance filter is applied in application code after the database query, not as a SQL expression.
- If `arbCenter` is null or `arbSize` is 0/falsy, no distance filtering is applied, which would effectively return all neurons (subject to collection filter).

---

## PredicateType: IdOrDoi

Finds neurons by matching neuron labels, specimen labels, or DOIs.

### Inputs

| Field | Type | Description |
|---|---|---|
| `labelsOrDois` | `[String!]` | The search terms. Matched against `neuronLabel`, `specimenLabel`, and `doi` fields in the SearchIndex. |
| `labelOrDoiExactMatch` | `Boolean` | If `true`, terms must match a field value exactly. If `false`, terms are matched as case-insensitive substrings. |

### Behavior

The matching strategy depends on the combination of `labelOrDoiExactMatch` and the number of search terms:

**Exact match (`labelOrDoiExactMatch = true`):**

A SearchIndex row matches if its `neuronLabel`, `doi`, or `specimenLabel` is exactly equal to any of the provided terms. Standard case-sensitive equality.

**Exact match with empty terms (`labelsOrDois` is empty):**

Uses exact match logic with an empty list, which matches no rows.

**Substring match with one term:**

A row matches if its `neuronLabel`, `doi`, or `specimenLabel` contains the term as a case-insensitive substring.

**Substring match with multiple terms:**

A row matches if, for any of the provided terms, its `neuronLabel`, `doi`, or `specimenLabel` contains that term as a case-insensitive substring. (The terms are OR'd together.)

### Notes

- Node count filtering is not applied for this predicate type.
- All three fields (`neuronLabel`, `doi`, `specimenLabel`) are always searched; there is no way to restrict the match to a single field.
- Substring matching is case-insensitive. Exact matching uses the database's default collation.

---

## Result Processing

After all predicates are evaluated and composed into a final set of neuron IDs:

1. The full Neuron records are fetched from the database for the matched IDs.
2. Results are sorted by `label` in descending lexicographic order.
3. The response includes a `totalCount` field representing the total number of published neurons globally (not the number of search results).
4. If any error occurs during the search, an empty result set is returned with the error details.

## Default Behavior

When no predicates are provided, a default AnatomicalRegion predicate is used with:
- No atlas structure filter (whole brain)
- No neuron structure filter (all compartments)
- No node structure filter (uses `nodeCount`)
- Operator `>=` with amount `0`
- Composition `OR`

This effectively returns all published neurons.
