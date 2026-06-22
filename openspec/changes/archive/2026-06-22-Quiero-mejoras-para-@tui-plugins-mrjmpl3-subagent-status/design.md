# Design: Subagent Status — Quality & Robustness

## Technical Approach

Nine independently-revertible changes across three tiers: (1) deduplication (mergeTokens, snapshot
call, test fixtures), (2) observability (debug gating, recovering indicator, i18n), (3) safety (SQL
param audit, hydration refactor, integration tests). Each backed by characterization tests before
structural changes.

## Architecture Decisions

### Decision: Debug logger (module-level, not threaded)

| Option                                        | Tradeoff                                             | Decision |
| --------------------------------------------- | ---------------------------------------------------- | -------- |
| Thread `debug` boolean through 5+ call stacks | Clean DI, but every factory signature changes        | ❌       |
| Module-level `setDebugEnabled` + `debugLog`   | Simple, testable via `afterEach`, no signature churn | ✅       |

**Rationale**: `createSQLiteRecoverySource` would need `debug` threaded through
`createRecoverySources` → `tui-runtime` → `options`. A module flag set once at bootstrap
(`createTuiRuntime` calls `setDebugEnabled(options.debug)`) avoids touching 5 intermediate
interfaces. Tests reset with `afterEach(() => setDebugEnabled(false))`.

### Decision: Hydration refactor via strategy object

Extract
`hydrateChildFromSessionActivity(sessionId, children, strategy, state, runningEvidenceIDs, options)`
— shared loop body. Both `hydrateChildStatusesFromClient` and `hydrateChildStatusesFromTuiState`
become thin wrappers providing `{ readSessionStatus, readMessageActivity }`.

### Decision: `recovering` lives in `SubagentState`

| Option                     | Tradeoff                                              | Decision |
| -------------------------- | ----------------------------------------------------- | -------- |
| Separate reactive flag     | Needs new wiring through TuiSnapshot                  | ❌       |
| `SubagentState.recovering` | Rides existing snapshot pipeline, zero new interfaces | ✅       |

**Rationale**: `buildTuiSnapshot` already receives `SubagentState`. Adding `recovering?: boolean`
means `renderStatusLine` can early-return the indicator with zero new plumbing.

### Decision: Integration tests in `test/integration/`

Keep Vitest config unchanged. Name convention `*.integration.test.ts` — fast for unit, `vitest run`
includes both. If CI latency becomes an issue, add `vitest --exclude 'test/integration/**'` as a
separate script.

## Data Flow: Recovery + Loading Indicator

```
refreshRunner(sessionId):
  nextState = clone(state)
  nextState.recovering = true                    ← set flag
  recovered = hydrateRecoverySourcesSafely(...)  ← python3 SQLite
  ... (hydration, reconcile, prune)
  nextState.recovering = false                   ← clear flag
  syncState(nextState)

buildTuiSnapshot(state):
  if state.recovering → "⟳ syncing..."
  else → normal status line

renderStatusLine(state):
  if state.recovering → t("syncing")
  else → renderAggregate + details
```

## Module Changes

| File                                                         | Action     | Summary                                                                                                                                        |
| ------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/debug.ts`                                        | **Create** | `setDebugEnabled(bool)` + `debugLog(...args)` — single module, zero deps                                                                       |
| `src/runtime/options.ts`                                     | Modify     | `debug?: boolean` in `ResolvedSubagentStatusPluginOptions`; normalize in `normalizeSubagentStatusPluginOptions` (default `false`)              |
| `src/runtime/tui-runtime.ts`                                 | Modify     | Call `setDebugEnabled(options.debug)` at bootstrap; set/clear `state.recovering` in refresh wrapper                                            |
| `src/runtime/tui-runtime-refresh.ts`                         | Modify     | Accept `debugLog` param or import directly; wrap recovery call with recovering toggle                                                          |
| `src/runtime/status-hydration.ts`                            | Modify     | Replace `console.log` → `debugLog`. Extract shared `hydrateChildStatuses` with strategy param. Keep both public functions as wrappers          |
| `src/runtime/stale-probe.ts`                                 | Modify     | `console.log` → `debugLog`                                                                                                                     |
| `src/runtime/snapshot.ts`                                    | Modify     | Audit — confirm single `hydrateSnapshotChild` call in `.map()`. No duplicate exists                                                            |
| `src/runtime/i18n.ts`                                        | Modify     | Add `syncing: "⟳ syncing..."` (en) / `"⟳ sincronizando..."` (es)                                                                               |
| `src/ui/view-model/status-line.ts`                           | Modify     | Early-return `t("syncing")` when `state.recovering`                                                                                            |
| `src/infrastructure/logs.ts`                                 | Modify     | Delete local `mergeTokens` (52-63), import `mergeSubagentTokens` from domain                                                                   |
| `src/infrastructure/recovery/sqlite.ts`                      | Modify     | Delete local `mergeTokens` (48-60), import from domain; `console.log` → `debugLog`; **SQL already parameterized** — verified, no change needed |
| `src/domain/types.ts`                                        | Modify     | Add `recovering?: boolean` to `SubagentState`                                                                                                  |
| `test/fixtures/subagent-state.ts`                            | Modify     | Already exports `createChild` — no change needed                                                                                               |
| `test/integration/persistence-roundtrip.integration.test.ts` | **Create** | Temp dir, save state.json, load, assert                                                                                                        |
| `test/integration/sqlite-recovery.integration.test.ts`       | **Create** | `execFileSync('python3', ...)` to seed real DB, run recovery, assert rows                                                                      |

## New Types / Interfaces

```typescript
// src/shared/debug.ts
export const setDebugEnabled = (enabled: boolean): void => { ... };
export const debugLog = (...args: unknown[]): void => { ... };

// In src/runtime/options.ts — ResolvedSubagentStatusPluginOptions
debug: boolean;  // defaults false

// In src/domain/types.ts — SubagentState
recovering?: boolean;

// Hydration strategy (in status-hydration.ts, internal)
type HydrationStrategy = {
  readSessionStatus: (sessionId: string) => unknown;
  readMessageActivity: (sessionId: string) => MessageActivity;
};
```

## Testing Strategy

| Layer       | What                         | How                                                                                                                |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Unit        | `debugLog` gating            | Spy on `console.log`, toggle `setDebugEnabled`, assert calls                                                       |
| Unit        | `mergeSubagentTokens` import | Verify local copies removed, only domain import remains                                                            |
| Unit        | Hydration strategy           | Characterization test before refactor: record both functions' outputs for known inputs, assert same after refactor |
| Integration | Persistence round-trip       | Temp file save/load/assert                                                                                         |
| Integration | SQLite recovery              | `python3 -c "..."` to seed DB, call `readSQLiteRecoveryRows`, assert status/timestamps                             |
| Static      | SQL param safety             | Grep for f-string interpolation patterns in `READ_SQLITE_RECOVERY_SCRIPT`                                          |
| Static      | `console.log` audit          | Grep for remaining `console.log` after gating                                                                      |

## Implementation Order

1. Create `src/shared/debug.ts` + add `debug` to `options.ts` + normalize
2. Replace all 11 `console.log` with `debugLog` (file-by-file, test each) ✓ characterization test
   capture first
3. Delete duplicate `mergeTokens` from `logs.ts` + `sqlite.ts`; verify imports
4. Audit `snapshot.ts` — dead code removal if found; confirmed single call already
5. Add `recovering` to `SubagentState` + toggle in refresh + render in `status-line.ts`
6. Add i18n keys
7. Hydration refactor: write characterization tests first, then extract strategy
8. Integration tests (persistence + SQLite recovery)

Each step independently revertible. Integration tests last.

## Risk Mitigation

| Risk                                | Mitigation                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hydration refactor changes behavior | Write characterization tests in **Step 1** of that task — capture both functions' output for 3 scenarios (running, terminal, ambiguous). Compare after refactor |
| SQL param regression                | Grep for `${parent_id}` or f-string `{parent_id}` in `READ_SQLITE_RECOVERY_SCRIPT` after merge — current code already uses `?`                                  |
| `debugLog` missed call site         | Final grep audit: `grep -rn 'console\.log' src/` should return 0                                                                                                |
| Integration test speed              | Isolated in `test/integration/`, no impact on unit test runtime                                                                                                 |

## Open Questions

- [ ] `createTuiRuntimeRefresh` — pass `debugLog` as param or import directly? Direct import avoids
      signature change.
- [ ] Persistence round-trip: use `formatPersistedSnapshot` + `loadState` or test at JSON level?
