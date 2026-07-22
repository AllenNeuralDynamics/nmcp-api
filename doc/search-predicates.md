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

**Example with three predicates: **

1. Predicate A produces `{N1, N2, N3}`
2. Predicate B (OR) produces `{N3, N4}` &rarr; accumulated = `{N1, N2, N3, N4}`
3. Predicate C (NOT) produces `{N2, N4}` &rarr; final = `{N1, N3}`

## Collection Filtering

When `collectionIds` is non-empty, every predicate (regardless of type) restricts its SearchIndex query to rows whose `collectionId` is in the provided list. This filter is applied at the database level before any other filtering.

---

## PredicateType: AnatomicalRegion

Finds neurons that have morphological data in specified brain regions, optionally filtered by neuron compartment type and threshold criteria.

### Inputs

| Field | Type | Description |
|---|---|---|
| `atlasStructureIds` | `[String!]` | Brain region IDs to search. Each selected region implicitly includes all of its descendant regions in the atlas hierarchy. If empty, or if only the whole-brain structure is selected, no region filter is applied (equivalent to searching the entire brain). |
| `neuronStructureId` | `String` | Neuron compartment type ID (soma, axon, dendrite). If provided, only SearchIndex rows for that compartment are matched. If empty, all compartment types are included. Also determines whether the threshold filter targets a node count or a compartment length (see Threshold Filtering below). |
| `nodeStructureId` | `String` | See Threshold Filtering below. |
| `operatorId` | `String` | See Threshold Filtering below. |
| `amount` | `Float` | See Threshold Filtering below. |

### Behavior

1. Query SearchIndex rows filtered by:
   - `atlasStructureId` in the expanded set of selected regions and their descendants (unless whole-brain or empty).
   - Threshold filter: depending on the combination of `neuronStructureId` and `nodeStructureId`, a `neuronStructureId` WHERE clause may be applied and either a node count column or a compartment length column is compared against the operator/amount threshold (see below).
   - `collectionId` restriction (if any).
2. Collect the distinct `neuronId` values from the matched rows.

### Threshold Filtering

An additional threshold filter is applied based on the combination of `neuronStructureId` and `nodeStructureId`. The `operatorId` and `amount` fields control the comparison:

| Field | Type | Description |
|---|---|---|
| `operatorId` | `String` | ID of a comparison operator (=, >, <, etc.). If omitted, defaults to `>` with `amount` 0 (i.e., at least one node). |
| `amount` | `Float` | The threshold value for the comparison. |

Available operators: `=`, `!=`, `>`, `<`, `>=`, `<=`.

Which SearchIndex column is compared depends on the combination of `neuronStructureId` and `nodeStructureId`:

**No `neuronStructureId` (empty or omitted):**

The total `nodeCount` column is compared against the operator/amount threshold.

**`neuronStructureId` is axon or dendrite, with a `nodeStructureId`:**

The SearchIndex row is filtered to that compartment type, and the column for the specified node type is compared:

| Node Type | SearchIndex Column |
|---|---|
| Fork point | `branchCount` |
| End point | `endCount` |
| Undefined / path | `pathCount` |
| Soma | No count column (filter is not applied) |

**`neuronStructureId` is axon or dendrite, without a `nodeStructureId`:**

Instead of a node count, the compartment length column is compared against the operator/amount threshold:

| Neuron Structure | SearchIndex Column |
|---|---|
| Axon | `axonLengthMicrometer` |
| Dendrite | `dendriteLengthMicrometer` |

This allows queries such as "axon length > 5000 micrometers in region X".

**`neuronStructureId` is soma:**

The `neuronStructureId` filter is applied as a presence check. The operator and amount are not used. See the soma note below.

### Notes

- **Soma as neuron structure**: When `neuronStructureId` selects soma, the search is effectively a presence check — does the neuron's soma reside in one of the specified atlas structures? The operator and amount are meaningless in this case because a soma is a single point: a SearchIndex row for the soma compartment only exists when the soma is located in that atlas structure, and it always has exactly one node.
- Selecting the whole-brain structure is treated as "no region filter" rather than literally filtering to that single ID. This ensures neurons with nodes outside the atlas ontology (e.g., soma-only entries) are not excluded.
- The atlas hierarchy expansion means selecting a parent region like "Isocortex" will match neurons in any child region (e.g., "MOp", "SSp", etc.).

---

## PredicateType: CustomRegion

Finds neurons whose soma falls within a spherical region in atlas coordinate space. This is purely a spatial filter on soma position.

### Inputs

| Field | Type | Description |
|---|---|---|
| `arbCenter` | `{x, y, z}` | Center point of the sphere in atlas coordinates (micrometers). |
| `arbSize` | `Float` | Radius of the sphere in micrometers. |

### Behavior

1. Query SearchIndex rows filtered by:
   - `neuronStructureId` restricted to soma (only soma rows have meaningful spatial position).
   - A bounding box pre-filter on `somaX`, `somaY`, `somaZ` (center &pm; radius), which allows database indexes to eliminate most rows.
   - An exact squared Euclidean distance check:
     ```
     (somaX - arbCenter.x)^2 + (somaY - arbCenter.y)^2 + (somaZ - arbCenter.z)^2 <= arbSize^2
     ```
   - `collectionId` restriction (if any).
2. Collect the distinct `neuronId` values from the matched rows.

### Notes

- All spatial filtering (bounding box and distance) is performed in the database query, not in application code.
- If `arbCenter` is null or `arbSize` is 0/falsy, no spatial filtering is applied. Only the soma neuron structure filter and optional collection filter are used.

---

## PredicateType: IdOrDoi

Finds neurons by matching neuron labels, specimen labels, or DOIs (both reconstruction and canonical).

### Inputs

| Field | Type | Description |
|---|---|---|
| `labelsOrDois` | `[String!]` | The search terms. Matched against `neuronLabel`, `specimenLabel`, `doi`, and `canonicalDoi` fields in the SearchIndex. |
| `labelOrDoiExactMatch` | `Boolean` | If `true`, terms must match a field value exactly. If `false`, terms are matched as case-insensitive substrings. |

### Behavior

The matching strategy depends on the combination of `labelOrDoiExactMatch` and the number of search terms:

**Exact match (`labelOrDoiExactMatch = true`):**

A SearchIndex row matches if its `neuronLabel`, `doi`, `canonicalDoi`, or `specimenLabel` is exactly equal to any of the provided terms. Standard case-sensitive equality.

**Exact match with empty terms (`labelsOrDois` is empty):**

Uses exact match logic with an empty list, which matches no rows.

**Substring match with one term:**

A row matches if its `neuronLabel`, `doi`, `canonicalDoi`, or `specimenLabel` contains the term as a case-insensitive substring.

**Substring match with multiple terms:**

A row matches if, for any of the provided terms, its `neuronLabel`, `doi`, `canonicalDoi`, or `specimenLabel` contains that term as a case-insensitive substring. (The terms are OR'd together.)

### Notes

- Threshold filtering is not applied for this predicate type.
- All four fields (`neuronLabel`, `doi`, `canonicalDoi`, `specimenLabel`) are always searched; there is no way to restrict the match to a single field.
- `doi` is the reconstruction-level DOI assigned to the atlas reconstruction; `canonicalDoi` is the neuron-level DOI.
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
