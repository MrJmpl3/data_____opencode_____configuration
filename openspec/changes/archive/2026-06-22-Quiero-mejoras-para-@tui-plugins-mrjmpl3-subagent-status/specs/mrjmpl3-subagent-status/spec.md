# Delta for mrjmpl3-subagent-status

## ADDED Requirements

### Requirement: Token merge uses canonical implementation

The system MUST consolidate all `mergeTokens` logic into the domain-layer `mergeSubagentTokens`.
Duplicates in infrastructure SHALL be removed and rewired to the canonical source.

#### Scenario: All token merging uses domain import

- GIVEN `logs.ts` and `sqlite.ts` define local `mergeTokens` copies
- WHEN the code is refactored
- THEN both MUST import `mergeSubagentTokens` from `domain/tokens.ts`
- AND local copies MUST be removed

### Requirement: Recovery SQL queries use parameterized placeholders

Recovery SQLite integration MUST use `?` parameterized placeholders instead of string interpolation
for `parentSessionID` to prevent injection.

#### Scenario: parentSessionID is parameterized

- GIVEN the Python recovery script receives a `parentSessionID`
- WHEN it executes the SQL query
- THEN the value MUST pass via the `(parent_id,)` parameter tuple
- AND the query MUST NOT use f-string interpolation

### Requirement: Snapshot hydration is called once per child

`buildTuiSnapshot` in `snapshot.ts` MUST call `hydrateSnapshotChild` exactly once per child row. No
redundant second pass SHALL exist.

#### Scenario: No duplicate hydration call

- GIVEN `snapshot.ts` builds a snapshot from children
- WHEN `buildTuiSnapshot` is invoked
- THEN `hydrateSnapshotChild` MUST be called once per child via `.map()`
- AND no second hydration call MUST exist in the same function

### Requirement: Test fixtures use shared exports

`createChild` MUST be exported from `test/fixtures/subagent-state.ts`. Test files SHALL import from
there instead of defining inline copies.

#### Scenario: createChild imported, not duplicated

- GIVEN a test file needs `createChild`
- WHEN the test suite runs
- THEN it MUST import from `test/fixtures/subagent-state.ts`
- AND MUST NOT define its own copy

### Requirement: Persistence round-trip integration test

The persistence layer MUST have a save-to-disk → load-from-disk integration test validating
structural integrity of children, counts, and timestamps.

#### Scenario: State round-trip preserves all data

- GIVEN a populated `SubagentState` with children and counts
- WHEN saved to a temp file and loaded back
- THEN loaded state MUST match original children, counts, `totalExecuted`, and `updatedAt`

### Requirement: SQLite recovery end-to-end integration test

The SQLite recovery source MUST have an integration test creating a real DB via `python3`,
populating session/part rows, and verifying recovery output.

#### Scenario: Recovery produces correct rows from real DB

- GIVEN a temp SQLite DB with session and part rows for a known `parentSessionID`
- WHEN `readSQLiteRecoveryRows` is called
- THEN returned rows MUST have correct `id`, `parentID`, `title`, and `status`

## MODIFIED Requirements

### Requirement: Recovery hydration prefers authoritative state

The system MUST hydrate missing state and token metadata from the best available recovery source.
Recovery state MUST win over stale local rows. Recovery SQL MUST use parameterized placeholders.
(Previously: No SQL injection prevention specified)

#### Scenario: Recovery fills missing token metadata

- GIVEN local state is missing token or session metadata
- WHEN a recovery source provides that metadata
- THEN the row MUST be hydrated with recovered values
- AND remain visible

#### Scenario: parentSessionID is always parameterized

- GIVEN the recovery SQLite script runs
- WHEN querying sessions by parent ID
- THEN the query MUST use a `?` placeholder
- AND the value passes in the execute parameters tuple

## RENAMED Requirements

### Requirement: Token and context hydration → Token and context hydration (internal merge tokens consolidated)

(Reason: All token-merge logic migrated to canonical `domain/tokens.ts` `mergeSubagentTokens`)
(Migration: Replace `mergeTokens` references in `logs.ts` and `sqlite.ts` with `mergeSubagentTokens`
import)
