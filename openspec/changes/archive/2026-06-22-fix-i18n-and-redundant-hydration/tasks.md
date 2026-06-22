# Tasks: Fix i18n and Consolidate Snapshot Hydration

## Review Workload Forecast

| Field                   | Value                                           |
| ----------------------- | ----------------------------------------------- |
| Estimated changed lines | ~55 (38 additions, 17 deletions across 6 files) |
| 400-line budget risk    | Low                                             |
| Chained PRs recommended | No                                              |
| Suggested split         | Single PR                                       |
| Delivery strategy       | single-pr                                       |
| Chain strategy          | size-exception                                  |

Decision needed before apply: No Chained PRs recommended: No Chain strategy: size-exception 400-line
budget risk: Low

## Phase 1: i18n — Add Missing Key (TDD RED → GREEN)

- [x] 1.1 **RED** Write failing `subagents_snapshot` test in `test/i18n.test.ts`
  - Assert `t('subagents_snapshot')` returns `'Subagents snapshot'` (en) and `'Subagentes snapshot'`
    (es)
  - Depends on: none
- [x] 1.2 **GREEN** Add `subagents_snapshot` to `Translations` object in `src/runtime/i18n.ts`
  - en: `'Subagents snapshot'`, es: `'Subagentes snapshot'` (no trailing colon — separator stays
    structural)
  - Run `vitest run` → task 1.1 passes

## Phase 2: i18n — Use t() in Status Line

- [x] 2.1 Rewrite `renderAggregate` in `src/ui/view-model/status-line.ts` with `t()` calls
  - Replace hardcoded `'Subagents:'`, `'run'`, `'done'`, `'err'` → `t('subagents')`, `t('run')`,
    `t('done')`, `t('err')`
  - Existing English tests stay green (byte-identical output)
  - Depends on: Phase 1
- [x] 2.2 Rewrite `renderSnapshotAggregate` with `t('subagents_snapshot')` directly
  - Delete regex `.replace(/^Subagents: /, 'Subagents snapshot: ')`; build with
    `t('subagents_snapshot')`
  - Depends on: 2.1
- [x] 2.3 **TDD** Add Spanish-locale render test in `test/render.test.ts`
  - Test: with `es` locale, `renderStatusLine` outputs `'Subagentes: ... act · ... listo · ... err'`
  - Test: with `es` locale, `renderStatusSnapshotLine` outputs `'Subagentes snapshot: ...'`
  - Depends on: 2.2

## Phase 3: Hydration — Consolidate to Single Canonical Definition

- [x] 3.1 **RED** Export `hydrateSnapshotChild` from `src/runtime/snapshot.ts` + make
      `buildSubagentSnapshotView` pure
  - Add `export` keyword to `hydrateSnapshotChild` in `snapshot.ts` (line 25)
  - In `src/ui/view-model/snapshot-view.ts`: delete duplicate `hydrateSnapshotChild` (lines 23-26),
    delete `resolveElapsedMs` import (line 3), remove `.map(hydrateSnapshotChild...)` from
    `buildSubagentSnapshotView` (line 40)
  - Tests go RED — callers not yet pre-hydrating
  - Depends on: Phase 2
- [x] 3.2 **GREEN** Pre-hydrate in `renderStatusLine` in `src/ui/view-model/status-line.ts`
  - Import `hydrateSnapshotChild` from `../../runtime/snapshot.ts`
  - Map children before `buildSubagentSnapshotView`:
    `Object.values(state.children).map(c => hydrateSnapshotChild(c, nowMs))`
  - Depends on: 3.1
- [x] 3.3 **GREEN** Pre-hydrate in `renderStatusSnapshotLine` in `src/ui/view-model/status-line.ts`
  - Same import + `.map(hydrateSnapshotChild(...))` pattern as 3.2
  - Depends on: 3.2
- [x] 3.4 **GREEN** Update direct test caller at `test/render.test.ts` line ~393
  - Import `hydrateSnapshotChild` from `../src/runtime/snapshot.ts`
  - Pre-hydrate `[recentDone, staleDone]` before `buildSubagentSnapshotView`
  - Depends on: 3.1

## Phase 4: Validation

- [x] 4.1 Run `vitest run` from `tui-plugins/mrjmpl3-subagent-status/` — all tests green
- [x] 4.2 Run `tsc --noEmit -p tsconfig.json` — no type errors
- [x] 4.3 Verify `hydrateSnapshotChild` exists in exactly 1 file: `src/runtime/snapshot.ts`

## Dependency Graph

```
1.1 (RED) → 1.2 (GREEN)
              ↓
         2.1 → 2.2 → 2.3 (TDD)
                        ↓
         3.1 (RED) ─┬→ 3.2 (GREEN)
                     ├→ 3.3 (GREEN)
                     └→ 3.4 (GREEN)
                        ↓
                    4.1 → 4.2 → 4.3
```

## Test Strategy Summary

| Layer       | New/Changed Tests             | File                  |
| ----------- | ----------------------------- | --------------------- |
| i18n key    | `subagents_snapshot` en + es  | `test/i18n.test.ts`   |
| render (en) | Existing assertions preserved | `test/render.test.ts` |
| render (es) | Spanish aggregate labels      | `test/render.test.ts` |
| hydration   | Pre-hydrated child contract   | `test/render.test.ts` |
| definition  | Canonical in `snapshot.ts`    | verify via step 4.3   |
