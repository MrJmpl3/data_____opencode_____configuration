# Delta for mrjmpl3-subagent-status

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Snapshot hydration is called once per child

`buildSubagentSnapshotView` in `snapshot-view.ts` MUST accept pre-hydrated children and MUST NOT
call `hydrateSnapshotChild` internally. All callers (`buildTuiSnapshot`, `renderStatusLine`,
`renderStatusSnapshotLine`) SHALL hydrate children before calling `buildSubagentSnapshotView`. There
SHALL be exactly ONE canonical definition of `hydrateSnapshotChild` (with full `color` + `elapsedMs`
resolution). The duplicate definition in `snapshot-view.ts` MUST be removed. (Previously: Only
required no duplicate call within `buildTuiSnapshot`; now consolidates the function definition
itself and enforces callers hydrate before the view builder.)

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
