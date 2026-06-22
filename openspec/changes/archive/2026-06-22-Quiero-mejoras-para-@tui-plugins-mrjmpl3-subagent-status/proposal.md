# Proposal: Subagent Status Plugin — Quality & Robustness Improvements

## Intent

Reduce technical debt, eliminate duplicated logic, harden recovery paths, and add test coverage for
the `mrjmpl3-subagent-status` TUI plugin. The plugin works reliably today but carries structural
fragility that makes maintenance harder and production behavior noisier than necessary.

## Problem Statement

The exploration identified 9+ concrete issues across four tiers of severity:

- **Critical**: SQLite recovery spawns `python3` synchronously with inline SQL (+740 lines, SQL
  injection risk, 2s timeout); 20+ un-gated `console.log` calls pollute stdout; `mergeTokens`
  duplicated in 3 places (domain, logs, sqlite).
- **High**: 441 lines duplicated in `status-hydration.ts` (two near-identical hydration functions);
  no integration tests for persistence round-trip or SQLite recovery.
- **Medium**: Test fixtures duplicated across files; `snapshot.ts` calls `hydrateSnapshotChild`
  twice; minimal i18n (7 keys, hardcoded symbols); `applyRecoveredChildren` mutates input directly.
- **Low**: No loading indicator during recovery refresh.

## Business Value

| Area        | Impact                                                                            |
| ----------- | --------------------------------------------------------------------------------- |
| Debugging   | Gated logging means production logs stay clean, debug mode available on demand    |
| Correctness | Unified `mergeTokens` eliminates drift between implementations                    |
| Safety      | Parameterized SQL queries remove injection risk in recovery path                  |
| Velocity    | Shared fixtures + deduplicated hydration logic reduce PR churn                    |
| Confidence  | Integration tests prove state.json round-trip and SQLite recovery work end-to-end |

## Scope

### In Scope (Phase 1 + Phase 2)

1. **Unify `mergeTokens`** — delete duplicate copies in `logs.ts` and `sqlite.ts`; import canonical
   from `domain/tokens.ts`
2. **Gate `console.log`** — add `debug` boolean to `ResolvedSubagentStatusPluginOptions`; wrap all
   11 `console.log` calls behind `if (options.debug)`
3. **Share test fixture** — move `child()` helper from `test/fixtures/subagent-state.ts` to a shared
   import; remove duplicates across test files
4. **Persistence integration test** — write a state.json round-trip test that saves, loads, and
   asserts structural integrity
5. **Remove duplicate `hydrateSnapshotChild` call** — `snapshot.ts` calls it once per child via
   `.map()`; confirm no second pass exists and remove dead call
6. **Sanitize `parentSessionID` in SQLite query** — replace raw string interpolation with
   parameterized `?` placeholder in the Python recovery script
7. **Refactor `status-hydration.ts`** — extract a shared hydration strategy that both
   `hydrateChildStatusesFromClient` and `hydrateChildStatusesFromTuiState` delegate to, eliminating
   the 441-line duplication
8. **SQLite recovery integration tests** — add tests that create a real SQLite DB via `python3`,
   populate session/part tables, and verify recovery output
9. **Loading indicator** — show a brief "recovering..." / "syncing..." indicator during recovery
   refresh in the TUI

### Out of Scope

- **Python subprocess replacement** (Phase 3) — replacing the `spawnSync('python3', ...)` approach
  with a native SQLite binding (e.g., `better-sqlite3` or `sql.js`). This is a larger investment
  with packaging implications, deferred to a future change.
- Architecture-level restructuring (package shell alignment with `mrjmpl3-quota`)
- i18n expansion beyond current 7 keys
- Non-debug console infrastructure (e.g., structured logging)
- CI/CD or release process changes

## Capabilities

> Contract between proposal and specs phases. Research performed against
> `openspec/specs/mrjmpl3-subagent-status/spec.md`.

### New Capabilities

- `subagent-status-observability`: Debug-mode logging and loading/recovering UI indicator

### Modified Capabilities

- `mrjmpl3-subagent-status`: Token merging centralized to domain layer; hydration logic
  deduplicated; SQLite recovery query parameterized; test coverage expanded with integration tests

## Approach

| #   | Item                        | Approach                                                                                                                                                                |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Unify `mergeTokens`         | Delete `mergeTokens` from `logs.ts:52-63` and `sqlite.ts:48-60`; rewire callers to `mergeSubagentTokens` from `domain/tokens.ts`                                        |
| 2   | Gate `console.log`          | Add `debug?: boolean` to `ResolvedSubagentStatusPluginOptions` (normalize in `normalizeSubagentStatusPluginOptions`, default `false`); thread through to all call sites |
| 3   | Share fixture               | Export `createChild` from `test/fixtures/subagent-state.ts`; replace inline copies in affected test files                                                               |
| 4   | Persistence integration     | Write `test/integration/persistence-roundtrip.test.ts` — create temp dir, save state, load state, assert children/counts/timestamps                                     |
| 5   | Duplicate call fix          | Audit `snapshot.ts` call sites; confirm single pass, remove stale second reference                                                                                      |
| 6   | SQLite param sanitization   | Replace f-string interpolation for `parent_id` in the inline Python script with `?` placeholder in the `cur.execute()` call                                             |
| 7   | Hydration refactor          | Extract shared loop body into `hydrateChildFromSessionActivity(sessionId, children, ...)`; both functions call it with their own API source                             |
| 8   | SQLite recovery integration | Extend `test/recovery.test.ts` with real-DB setup via `execFileSync('python3', ...)` (pattern already exists), assert recovery output matches expectations              |
| 9   | Loading indicator           | Add `recovering` boolean to state; toggle during recovery phase; render "⟳ syncing..." in status line when active                                                       |

## Affected Areas

| Area                                    | Impact   | Description                                     |
| --------------------------------------- | -------- | ----------------------------------------------- |
| `src/domain/tokens.ts`                  | Modified | Already canonical — no changes needed           |
| `src/infrastructure/logs.ts`            | Modified | Remove `mergeTokens`, use import from domain    |
| `src/infrastructure/recovery/sqlite.ts` | Modified | Remove `mergeTokens`, sanitize query, gate logs |
| `src/runtime/status-hydration.ts`       | Modified | Extract shared hydration strategy               |
| `src/runtime/snapshot.ts`               | Modified | Remove duplicate `hydrateSnapshotChild` call    |
| `src/runtime/options.ts`                | Modified | Add `debug` option                              |
| `src/runtime/stale-probe.ts`            | Modified | Gate console.log                                |
| `src/runtime/tui-runtime.ts`            | Modified | Gate console.log, add loading state             |
| `src/runtime/i18n.ts`                   | Modified | Add "recovering" / "syncing" translation keys   |
| `src/domain/state.ts`                   | Modified | No changes (re-exports)                         |
| `test/fixtures/subagent-state.ts`       | Modified | Export `createChild` for shared use             |
| `test/recovery.test.ts`                 | Extended | Add SQLite recovery integration tests           |
| `test/persistence.test.ts`              | Extended | Add state.json round-trip test                  |

## Risks

| Risk                                                   | Likelihood | Mitigation                                                                              |
| ------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| Hydration refactor breaks running-session tracking     | Medium     | Write tests that capture current behavior first (characterization tests), then refactor |
| SQLite parameterization changes Python script behavior | Low        | Existing tests already exercise Python execution path; run them after change            |
| `debug` option not threaded to all log sites           | Medium     | grep-based audit after change to catch any missed calls                                 |
| Integration tests are slow (python3 spawn)             | Medium     | Keep integration tests in a separate `describe` block; CI can run them selectively      |

## Rollback Plan

- Each item is independently revertible: revert the file in question and re-run tests
- Hydration refactor: keep old functions alongside new shared strategy until verification passes,
  then drop originals
- If integration tests add >30s to test suite: move to `test/integration/` with a separate npm
  script

## Dependencies

- Node.js `child_process.execFileSync` for SQLite DB setup in integration tests (already a pattern
  in `test/recovery.test.ts`)
- `python3` on PATH for SQLite recovery integration tests (same as production)

## Success Criteria

- [ ] All tests pass: `vitest run` exits 0, `tsc --noEmit` reports zero errors
- [ ] `mergeTokens` appears exactly once (in `domain/tokens.ts`)
- [ ] Zero `console.log` calls execute when `debug: false` (verified via spy)
- [ ] `parentSessionID` is always passed as SQL parameter, never string-interpolated
- [ ] State.json round-trip test preserves children, counts, timestamps
- [ ] SQLite recovery test verifies terminal status, timestamps, token hydration from real DB
- [ ] No visible behavior regression — existing `status-hydration.test.ts` and `recovery.test.ts`
      assertions pass unchanged
- [ ] Loading indicator appears during recovery and disappears on completion
