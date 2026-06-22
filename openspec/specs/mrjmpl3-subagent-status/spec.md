# mrjmpl3-subagent-status Specification

## Purpose

Provide a mouse-only subagent status panel that keeps child sessions in sync, preserves terminal
rows through out-of-order updates, enriches finished rows with token/context data when available,
and renders clickable status rows without keyboard or focus controls.

## Requirements

### Requirement: Accurate child-session reconciliation

The system MUST normalize incoming child snapshots into stable rows, count each execution once, and
resolve fallback/session duplicates to a single execution. It MUST preserve terminal rows once
completed or errored, and newer running evidence MUST NOT regress a terminal row or resume elapsed
time. Event-path handling MUST treat `session.idle` as non-terminal unless separate authoritative
completion or error evidence is present.

#### Scenario: Duplicate fallback row is rekeyed once

- GIVEN a fallback row and a real session row describe the same child work
- WHEN the next snapshot is reconciled
- THEN the plugin MUST keep one visible execution
- AND total executed MUST remain unchanged

#### Scenario: Stale running row becomes terminal

- GIVEN a row is still marked running but newer child-session information indicates completion or
  failure
- WHEN the plugin refreshes
- THEN the row MUST update to the terminal status
- AND its elapsed time MUST stop advancing

#### Scenario: Old terminal rows are removed safely

- GIVEN terminal rows are older than the retention window
- WHEN state is loaded or refreshed
- THEN those rows MUST be pruned from the visible list
- AND recent terminal rows MUST remain visible

#### Scenario: Idle-only event keeps the child non-terminal

- GIVEN a child row exists for a delegated session
- WHEN the event path receives only `session.idle` for that session
- THEN the row MUST remain `running`
- AND `endedAt` MUST remain unset

#### Scenario: Later completion evidence terminalizes an idle child

- GIVEN a child row previously saw `session.idle` without terminalizing
- WHEN later `session.status` or recovery/message evidence explicitly indicates completion
- THEN the row MUST update to `done`
- AND the terminal timestamp MUST come from that later evidence

#### Scenario: Later error evidence overrides prior idle-only state

- GIVEN a child row previously saw `session.idle` without terminalizing
- WHEN later `session.error` or equivalent authoritative error evidence arrives
- THEN the row MUST update to `error`
- AND the row MUST NOT remain stuck in a false done state

### Requirement: Token and context hydration (internal merge tokens consolidated)

The system MUST hydrate completed child rows with token totals or context percentage when
recoverable. If no usable token data exists, the row MUST still render without token metadata. All
token-merge logic SHALL use the canonical `mergeSubagentTokens` from `domain/tokens.ts`.

#### Scenario: Completed row shows token metadata

- GIVEN a completed child row has recoverable token totals
- WHEN the plugin refreshes
- THEN the row MUST display token or context metadata
- AND its status MUST remain completed or errored

#### Scenario: No token data does not block rendering

- GIVEN a completed child row has no recoverable token data
- WHEN the plugin refreshes
- THEN the row MUST still render
- AND the token area MUST remain empty

### Requirement: Recovery hydration prefers authoritative state

The system MUST hydrate missing state and token metadata from the best available recovery source.
Recovery state MUST win over stale local rows. Recovery SQL MUST use parameterized placeholders.
(Previously: No SQL injection prevention specified)

#### Scenario: Recovery fills missing token metadata

- GIVEN local state is missing token or session metadata
- WHEN a recovery source provides that metadata
- THEN the row MUST be hydrated with the recovered values
- AND the row MUST remain visible

#### Scenario: Recovery overrides stale local running state

- GIVEN local state shows a row as running
- WHEN recovery data shows the same row as terminal
- THEN the terminal recovery state MUST win
- AND the stale running state MUST NOT be restored

#### Scenario: parentSessionID is always parameterized

- GIVEN the recovery SQLite script runs
- WHEN querying sessions by parent ID
- THEN the query MUST use a `?` placeholder
- AND the value passes in the execute parameters tuple

### Requirement: Stale-row retention is bounded

The system MUST bound retention of stale or incorrect legacy rows. If a row cannot be reconciled to
an accurate state, the system MAY purge it instead of preserving incorrect visible state, and purged
rows MUST NOT be resurrected by later stale snapshots.

#### Scenario: Irreconcilable legacy row is purged

- GIVEN a legacy row cannot be matched to a current authoritative state
- WHEN state is loaded or refreshed
- THEN the row MAY be removed from visible state
- AND the incorrect row MUST NOT remain visible

#### Scenario: Purged rows are not brought back by stale input

- GIVEN a row has been purged as stale
- WHEN a later stale snapshot repeats the same incorrect row
- THEN the row MUST stay absent unless authoritative recovery recreates it

### Requirement: Mouse-only status rendering and navigation

The system MUST render an expandable status area with per-status counts, total executed count, and
per-row elapsed time. It MUST allow mouse navigation from clickable child rows only and MUST NOT
expose keyboard shortcuts, focus restoration, or command-palette controls.

#### Scenario: Clickable session row navigates to child session

- GIVEN a rendered row has a target session ID
- WHEN the user clicks it with the mouse
- THEN the plugin MUST navigate to that child session
- AND the row MUST keep its current visual status

#### Scenario: Counts render and keyboard input does nothing

- GIVEN the visible children include running, done, and error rows
- WHEN the plugin renders the status area or the user presses keyboard keys
- THEN the aggregate counters MUST match the visible rows
- AND no keyboard-driven control or focus behavior MUST be available

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

`buildSubagentSnapshotView` in `snapshot-view.ts` MUST accept pre-hydrated children and MUST NOT
call `hydrateSnapshotChild` internally. All callers (`buildTuiSnapshot`, `renderStatusLine`,
`renderStatusSnapshotLine`) SHALL hydrate children before calling `buildSubagentSnapshotView`. There
SHALL be exactly ONE canonical definition of `hydrateSnapshotChild` (with full `color` + `elapsedMs`
resolution). The duplicate definition in `snapshot-view.ts` MUST be removed.

#### Scenario: No duplicate hydration call

- GIVEN `snapshot.ts` builds a snapshot from children
- WHEN `buildTuiSnapshot` is invoked
- THEN `hydrateSnapshotChild` MUST be called once per child via `.map()`
- AND `buildSubagentSnapshotView` MUST NOT hydrate children internally

#### Scenario: Single canonical hydrateSnapshotChild definition

- GIVEN the codebase after consolidation
- WHEN searching for `hydrateSnapshotChild` function definitions
- THEN exactly ONE definition MUST exist (in `snapshot.ts`)
- AND it MUST resolve both `color` via `statusColor()` and `elapsedMs` via `resolveElapsedMs()`
- AND the duplicate in `snapshot-view.ts` MUST be removed

#### Scenario: renderStatusLine hydrates before building view

- GIVEN `renderStatusLine` is called with raw `state.children`
- WHEN it builds the snapshot view
- THEN it MUST hydrate children via the canonical `hydrateSnapshotChild` BEFORE passing to
  `buildSubagentSnapshotView`
- AND `buildSubagentSnapshotView` MUST receive children with both `color` and `elapsedMs` resolved

#### Scenario: buildTuiSnapshot path passes pre-hydrated children

- GIVEN `buildTuiSnapshot` is called
- WHEN it hydrates children with `hydrateSnapshotChild`
- THEN the hydrated children MUST be passed to `buildSubagentSnapshotView`
- AND `buildSubagentSnapshotView` MUST NOT hydrate them a second time

### Requirement: Status line aggregate uses i18n keys

`renderAggregate` and `renderSnapshotAggregate` in `status-line.ts` MUST use `t()`-based i18n
lookups instead of hardcoded English strings. The `subagents_snapshot` i18n key SHALL be added to
`runtime/i18n.ts` for the "Subagents snapshot:" prefix. The `renderSnapshotAggregate` function MUST
NOT rely on regex `.replace()` on a hardcoded English prefix.

#### Scenario: Status line renders localized aggregate labels

- GIVEN the system locale is `es`
- WHEN `renderStatusLine(state, nowMs)` is called with a non-empty state
- THEN the aggregate prefix MUST use `t('subagents')` ("Subagentes")
- AND the status suffixes MUST use `t('run')`, `t('done')`, `t('err')` instead of hardcoded "run",
  "done", "err"

#### Scenario: Snapshot aggregate uses dedicated i18n key

- GIVEN the system locale is `es`
- WHEN `renderStatusSnapshotLine(state, nowMs)` is called
- THEN the aggregate prefix MUST use `t('subagents_snapshot')` (e.g., "Subagentes snapshot:")
- AND no regex-based string replacement on English text SHALL exist in `renderSnapshotAggregate`

#### Scenario: i18n keys exist for all aggregate labels

- GIVEN the `Translations` object in `runtime/i18n.ts`
- WHEN the locale is `en` or `es`
- THEN `t('subagents')`, `t('subagents_snapshot')`, `t('run')`, `t('done')`, `t('err')` MUST all
  return non-empty strings

#### Scenario: Existing tests still pass with i18n-aware rendering

- GIVEN the test suite runs with locale `en`
- WHEN `renderStatusLine` is invoked in tests that assert `.toContain('Subagents:')`
- THEN those assertions MUST still pass because English i18n keys produce identical output

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
