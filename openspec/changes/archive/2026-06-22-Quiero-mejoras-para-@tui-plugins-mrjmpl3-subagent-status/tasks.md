# Tasks: Subagent Status — Quality & Robustness

## Review Workload Forecast

| Field                   | Value                                  |
| ----------------------- | -------------------------------------- |
| Estimated changed lines | ~500 (280 source + 220 test)           |
| 400-line budget risk    | Medium                                 |
| Chained PRs recommended | No                                     |
| Suggested split         | Single PR (local change, no GitHub PR) |
| Delivery strategy       | single-pr                              |
| Chain strategy          | size-exception                         |

Decision needed before apply: No Chained PRs recommended: No Chain strategy: size-exception 400-line
budget risk: Medium

## Phase 1: Foundation — Debug Infrastructure

- [ ] 1.1 Create `src/shared/debug.ts` with `setDebugEnabled(bool)` + `debugLog(...args)` —
      module-level flag, zero deps. **Write test first**: spy on `console.log`, toggle flag, assert
      output gating
- [ ] 1.2 Add `debug?: boolean` to `SubagentStatusPluginOptions` +
      `ResolvedSubagentStatusPluginOptions` in `src/runtime/options.ts`; normalize to `false`
      default in `normalizeSubagentStatusPluginOptions`. **Write test first**: update
      `options.test.ts` with resolved `debug: false` when omitted and `debug: true` when strictly
      `true`
- [ ] 1.3 Call `setDebugEnabled(options.debug)` at bootstrap in `src/runtime/tui-runtime.ts` —
      single call after options resolution

## Phase 2: Observability — console.log Gating

- [ ] 2.1 Replace all 11 `console.log` with `debugLog` across 5 files:
  - `src/runtime/tui-runtime.ts` (2 calls: lines 156, 171)
  - `src/runtime/status-hydration.ts` (2 calls: lines 270, 302)
  - `src/runtime/stale-probe.ts` (1 call: line 134)
  - `src/infrastructure/recovery/sqlite.ts` (6 calls: lines 581, 588, 707, 711, 713, 718) **Write
    test first**: characterize each call site output with `debugLog` active, assert silence when
    disabled. Use `afterEach(() => setDebugEnabled(false))` reset

## Phase 3: Code Cleanup — MergeTokens + Snapshot Audit

- [ ] 3.1 Delete local `mergeTokens` from `src/infrastructure/logs.ts` (lines 52-63), import
      `mergeSubagentTokens` from `src/domain/tokens.ts`; replace the 2 call sites
      (`extractTokenHints` line 122, `extractTokensFromLine` line 177, `hydrateDoneChildTokens` line
      229, `resolveRecoveredStatus` lines 463, etc.). **Write test first**: assert no local
      `mergeTokens` definition remains, verify imports resolve
- [ ] 3.2 Delete local `mergeTokens` from `src/infrastructure/recovery/sqlite.ts` (lines 48-60),
      import `mergeSubagentTokens` from `src/domain/tokens.ts`; replace 5 call sites in
      `resolveRecoveredStatus`. **Write test first**: assert no local `mergeTokens` in sqlite.ts
- [ ] 3.3 Audit `src/runtime/snapshot.ts` — confirm `hydrateSnapshotChild` is called exactly once
      (line 38 via `.map()`), no second pass. No code change expected unless a duplicate is found

## Phase 4: Observability — Recovery Indicator

- [ ] 4.1 Add `recovering?: boolean` to `SubagentState` interface in `src/domain/types.ts`
- [ ] 4.2 Add `syncing: "⟳ syncing..."` (en) + `syncing: "⟳ sincronizando..."` (es) to
      `src/runtime/i18n.ts`. **Write test first**: extend `i18n.test.ts` with locale assertions for
      new keys
- [ ] 4.3 Modify `src/runtime/tui-runtime-refresh.ts` — clone state, set `recovering = true` before
      `hydrateRecoverySourcesSafely`, set `recovering = false` after reconcile/hydration (before
      `syncState`). **Write test first**: use a mock recovery source to verify flag toggle in
      refresh flow
- [ ] 4.4 Add early-return syncing indicator in `src/ui/view-model/status-line.ts` — both
      `renderStatusLine` and `renderStatusSnapshotLine`: if `state.recovering`, return
      `t("syncing")`. **Write test first**: assert `renderStatusLine` returns syncing text when
      recovering is true

## Phase 5: Hydration Refactor

- [ ] 5.1 Write characterization tests for `hydrateChildStatusesFromClient` and
      `hydrateChildStatusesFromTuiState` — capture output for 3 scenarios (running session, terminal
      session, ambiguous step-finish) using known `SubagentState` + mock `TuiPluginApi`. Record
      before-refactor behavior
- [ ] 5.2 Extract shared loop body into internal
      `hydrateChildFromSessionActivity(sessionId, children, strategy, state, runningEvidenceIDs, options)`
      where strategy = `{ readSessionStatus, readMessageActivity }`. Both public functions become
      thin wrappers. Run characterization tests — diff must be zero

## Phase 6: Integration Tests

- [ ] 6.1 Create `test/integration/persistence-roundtrip.integration.test.ts` — temp dir, save
      `SubagentState` via `formatPersistedSnapshot`, load via `loadState`, assert children, counts,
      `totalExecuted`, `updatedAt` match
- [ ] 6.2 Create `test/integration/sqlite-recovery.integration.test.ts` —
      `execFileSync('python3', ...)` to seed real SQLite DB with session + part rows for known
      `parentSessionID`, run `readSQLiteRecoveryRows`, assert returned rows have correct `id`,
      `parentID`, `title`, `status`

## Dependency Graph

```
Phase 1 (debug.ts + options)
  └─► Phase 2 (console.log→debugLog)
Phase 3 (mergeTokens + audit) ─── independent ──┐
                                                 ├─► any order
Phase 4 (recovering + i18n + status-line) ──────┘
  ├─► 4.1 (types) → 4.3 (refresh toggle)
  ├─► 4.2 (i18n)
  └─► 4.4 (status-line) needs 4.1 + 4.2
Phase 5 (hydration refactor)
  └─► 5.1 (char tests) → 5.2 (refactor)
Phase 6 (integration tests) ─── independent
```

Phases 1–4 have no cross-dependency with Phase 5 or Phase 6. Phase 5.1 blocks 5.2. All other phases
can be implemented in any order after prerequisites are met.

## Test Strategy Summary

| Layer       | Test                                   | Type             | Approach                                                                   |
| ----------- | -------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| Unit        | `debugLog` gating                      | Unit             | Spy `console.log`, toggle `setDebugEnabled`, assert calls                  |
| Unit        | Options `debug` normalization          | Unit             | Extend `options.test.ts` with `debug` field                                |
| Unit        | `console.log` → `debugLog` replacement | Unit             | Per-call-site characterization: debug on→output, off→silence               |
| Unit        | `mergeTokens` removal                  | Unit             | Assert only `mergeSubagentTokens` imported                                 |
| Unit        | Recovery indicator rendering           | Unit             | `renderStatusLine` returns `t("syncing")` when `recovering=true`           |
| Unit        | i18n `syncing` key                     | Unit             | Extend `i18n.test.ts` for en/es                                            |
| Char        | Hydration functions                    | Characterization | Record output for 3 scenarios before refactor, diff after                  |
| Integration | Persistence round-trip                 | Integration      | Temp file save/load/assert structural integrity                            |
| Integration | SQLite recovery                        | Integration      | `python3` seeds real DB, assert `readSQLiteRecoveryRows` output            |
| Static      | SQL param safety                       | Static           | Grep for `${parent_id}` f-string patterns (expected: 0 — already uses `?`) |
| Static      | Remaining `console.log`                | Static           | Final `grep -rn 'console\.log' src/` (expected: 0)                         |
