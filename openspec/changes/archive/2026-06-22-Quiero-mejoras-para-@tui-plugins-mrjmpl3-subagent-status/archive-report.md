# Archive Report: Subagent Status Plugin — Quality & Robustness Improvements

## Change Metadata

| Field              | Value                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **Change name**    | Quiero mejoras para @tui-plugins/mrjmpl3-subagent-status                                        |
| **Change folder**  | `openspec/changes/archive/2026-06-22-Quiero-mejoras-para-@tui-plugins-mrjmpl3-subagent-status/` |
| **Archived at**    | 2026-06-22                                                                                      |
| **Artifact store** | openspec                                                                                        |
| **Archive type**   | Normal (completed)                                                                              |

## Intent

Reduce technical debt, eliminate duplicated logic, harden recovery paths, and add test coverage for
the `mrjmpl3-subagent-status` TUI plugin.

## Final Artifact Inventory

| Artifact       | Path                                                                            | Status                                                 |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Proposal       | `openspec/changes/archive/2026-06-22-.../proposal.md`                           | ✅                                                     |
| Delta Spec     | `openspec/changes/archive/2026-06-22-.../specs/mrjmpl3-subagent-status/spec.md` | ✅                                                     |
| Design         | `openspec/changes/archive/2026-06-22-.../design.md`                             | ✅                                                     |
| Tasks          | `openspec/changes/archive/2026-06-22-.../tasks.md`                              | ✅ Completed (stale checkboxes reconciled — see below) |
| Archive Report | `openspec/changes/archive/2026-06-22-.../archive-report.md`                     | ✅ (this file)                                         |

## Stale Checkbox Reconciliation

The persisted `tasks.md` still contains unchecked (`- [ ]`) checkboxes because `sdd-apply` did not
update the tasks artifact after completing each task.

**Evidence of completion:**

- **Source changes verified**: All 15 planned tasks across 6 phases are implemented in the source
  code
- **Test results**: `vitest run` — 25/25 test files, 248/248 tests PASS
- **TypeScript**: `tsc --noEmit` — 0 errors
- **`console.log` in src**: Only `src/shared/debug.ts` has the actual `console.log` (the gating
  module) — all other files use `debugLog`
- **`mergeTokens`**: Removed from `logs.ts` and `sqlite.ts`; both import `mergeSubagentTokens` from
  `domain/tokens.ts`
- **`recovering` state**: Added to `SubagentState` interface, toggled in `tui-runtime-refresh.ts`,
  rendered in `status-line.ts`
- **i18n keys**: `syncing` added for both `en` and `es` locales
- **`debug` option**: Added to `ResolvedSubagentStatusPluginOptions`, normalized to `false`, wired
  at bootstrap
- **Integration tests**: `persistence-roundtrip.integration.test.ts` (2 tests) +
  `sqlite-recovery.integration.test.ts` (3 tests) both exist and pass

**Reconciliation decision**: Proceed with archive (orchestrator-authorized reconciliation based on
verified apply-progress and test results).

## Specs Synced

| Domain                    | Action  | Details                                     |
| ------------------------- | ------- | ------------------------------------------- |
| `mrjmpl3-subagent-status` | Updated | 1 renamed, 1 modified, 6 added requirements |

### Merge Details

- **Renamed**: "Token and context hydration" → "Token and context hydration (internal merge tokens
  consolidated)" — notes that `mergeSubagentTokens` from `domain/tokens.ts` is the canonical source
- **Modified**: "Recovery hydration prefers authoritative state" — added SQL parameterized
  placeholder requirement and `parentSessionID is always parameterized` scenario
- **Added**: 6 new requirements —
  1. Token merge uses canonical implementation
  2. Recovery SQL queries use parameterized placeholders
  3. Snapshot hydration is called once per child
  4. Test fixtures use shared exports
  5. Persistence round-trip integration test
  6. SQLite recovery end-to-end integration test

## Verification Outcome

| Check                               | Result                                                  |
| ----------------------------------- | ------------------------------------------------------- |
| Unit tests                          | ✅ 248/248 passed (25 files)                            |
| TypeScript type check               | ✅ 0 errors                                             |
| Integration tests (persistence)     | ✅ 2/2 passed                                           |
| Integration tests (SQLite recovery) | ✅ 3/3 passed                                           |
| `console.log` audit (src/)          | ✅ Only in `debug.ts` gating module                     |
| `mergeTokens` duplicates            | ✅ 0 — both `logs.ts` and `sqlite.ts` use domain import |

## Key Metrics

| Metric                 | Value                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phases planned         | 6                                                                                                                                                                      |
| Tasks planned          | 15                                                                                                                                                                     |
| Test files             | 25 passing                                                                                                                                                             |
| Tests added (new)      | ~10 (debug, recovering, i18n, integration)                                                                                                                             |
| Source files created   | 1 (`src/shared/debug.ts`)                                                                                                                                              |
| Source files modified  | 9 (`options.ts`, `tui-runtime.ts`, `tui-runtime-refresh.ts`, `status-hydration.ts`, `stale-probe.ts`, `i18n.ts`, `status-line.ts`, `sqlite.ts`, `logs.ts`, `types.ts`) |
| Integration test files | 2 (`persistence-roundtrip`, `sqlite-recovery`)                                                                                                                         |

## Known Limitations & Deferred Items

| Item                             | Status         | Notes                                                                                      |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| Python subprocess replacement    | Deferred       | Replacing `spawnSync('python3', ...)` with native SQLite binding deferred to future change |
| Architecture-level restructuring | Deferred       | Package shell alignment with `mrjmpl3-quota`                                               |
| i18n expansion                   | Deferred       | Beyond current 7 keys                                                                      |
| Structured logging               | Deferred       | Non-debug console infrastructure                                                           |
| Coverage threshold               | Not configured | `@vitest/coverage-v8` is not installed                                                     |

## Rollback Instructions

The change is independently revertible per phase:

| Phase                              | Rollback                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** (debug infrastructure) | Revert `src/shared/debug.ts` creation; revert `src/runtime/options.ts` `debug` field; remove `setDebugEnabled` call from `tui-runtime.ts` |
| **Phase 2** (console.log gating)   | Revert `debugLog` → `console.log` in all 4 files; remove `setDebugEnabled` import                                                         |
| **Phase 3** (mergeTokens cleanup)  | Restore local `mergeTokens` definitions in `logs.ts` and `sqlite.ts`; revert imports to local                                             |
| **Phase 4** (recovery indicator)   | Remove `recovering` from `SubagentState`; revert `tui-runtime-refresh.ts` toggle; revert `status-line.ts` early-return; revert i18n keys  |
| **Phase 5** (hydration refactor)   | Restore old `hydrateChildStatusesFromClient` and `hydrateChildStatusesFromTuiState` implementations                                       |
| **Phase 6** (integration tests)    | Delete `test/integration/persistence-roundtrip.integration.test.ts` and `test/integration/sqlite-recovery.integration.test.ts`            |

Each item is independently revertible: revert the file in question and re-run tests.

## Source of Truth Updated

- `openspec/specs/mrjmpl3-subagent-status/spec.md` — Now reflects all new and modified requirements

## SDD Cycle Complete

The change has been fully planned (proposal, spec, design), implemented (15 tasks, 6 phases),
verified (248/248 tests, clean type check), and archived.
