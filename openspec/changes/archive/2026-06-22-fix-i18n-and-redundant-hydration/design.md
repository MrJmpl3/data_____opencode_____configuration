# Design: Fix i18n and Consolidate Snapshot Hydration

## Overview

Two surgical bug fixes in the `mrjmpl3-subagent-status` plugin:

1. **i18n leak in status line** — `renderAggregate` and `renderSnapshotAggregate` in
   `src/ui/view-model/status-line.ts` emit hardcoded English (`"Subagents:"`, `"run"`, `"done"`,
   `"err"`) plus a `.replace()` regex hack for the snapshot variant, ignoring the existing `t()`
   i18n system.
2. **Duplicated `hydrateSnapshotChild`** — exists in both `src/runtime/snapshot.ts` (resolves
   `color` + `elapsedMs`) and `src/ui/view-model/snapshot-view.ts` (resolves only `elapsedMs`); the
   latter re-hydrates already-hydrated children.

The spec overrides the proposal: the canonical `hydrateSnapshotChild` (with `color` + `elapsedMs`)
remains in `snapshot.ts`, not `snapshot-view.ts`. No schema, runtime, or public API changes.

## Architecture Decisions

| #    | Decision                                      | Choice                                                                                                           | Rationale                                                                                                                  |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| AD-1 | Canonical `hydrateSnapshotChild` location     | Keep in `snapshot.ts`; export; remove the `snapshot-view.ts` copy                                                | Spec mandates location; `snapshot.ts` already has the full `color` + `elapsedMs` resolution                                |
| AD-2 | `buildSubagentSnapshotView` responsibility    | Pure view builder — pre-hydrated children only, no internal hydration                                            | Spec: "MUST NOT call `hydrateSnapshotChild` internally"; removes divergent `color` resolution                              |
| AD-3 | Hydration at call sites                       | All 3 production callers + the direct test caller pre-hydrate via the exported helper                            | Uniform contract; explicit > implicit                                                                                      |
| AD-4 | `subagents_snapshot` values                   | `en: "Subagents snapshot"`, `es: "Subagentes snapshot"` (no trailing colon — colon stays a structural separator) | Matches current regex output; minimum diff                                                                                 |
| AD-5 | English test assertions                       | Keep literal; no `vi.resetModules()` boilerplate                                                                 | English i18n values are byte-identical to current hardcoded output → zero regression risk; add 1 Spanish test per scenario |
| AD-6 | Direct test call at `test/render.test.ts:393` | Update test to pre-hydrate via imported `hydrateSnapshotChild`                                                   | Documents the new caller contract in code                                                                                  |

## Module Changes

### `src/runtime/i18n.ts`

Add `subagents_snapshot: 'Subagents snapshot'` (en) and `'Subagentes snapshot'` (es). Additive;
`as const` enforces both locales.

### `src/ui/view-model/status-line.ts`

- `renderAggregate` → `\`${t('subagents')}: ${r} ${t('run')} · ${d} ${t('done')} · ${e}
  ${t('err')}\``
- `renderSnapshotAggregate` → build directly with `t('subagents_snapshot')`; delete the `.replace()`
  regex
- `renderStatusLine` / `renderStatusSnapshotLine` import `hydrateSnapshotChild` from
  `../../runtime/snapshot.ts` and `.map()` before `buildSubagentSnapshotView`

### `src/runtime/snapshot.ts`

Add `export` to the `hydrateSnapshotChild` declaration. No body change.

### `src/ui/view-model/snapshot-view.ts`

Delete: `hydrateSnapshotChild` definition, the `resolveElapsedMs` import, and the `.map(hydrate...)`
step. `buildSubagentSnapshotView` becomes: `[...children].sort(byPriority)` → `collapse` →
`visibility`.

### `test/render.test.ts`

Import `hydrateSnapshotChild`; map the line 393 input before calling `buildSubagentSnapshotView`.
Existing assertions unchanged.

### `test/i18n.test.ts`

Add assertions for `t('subagents_snapshot')` in both `en` and `es` branches.

## Data Flow

```
   state.children ──► .map(hydrateSnapshotChild)  ◄── color + elapsedMs
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 buildTuiSnapshot       renderStatusLine       renderStatusSnapshotLine
        │                       │                       │
        └─────────► buildSubagentSnapshotView ◄──────────┘
                   (pure: no internal hydration)
```

All three callers converge on the same hydration step. `renderAggregate` / `renderSnapshotAggregate`
call `t()` directly so localized labels flow through unchanged.

## Test Strategy

| Layer     | What                                                                                   | File                                  |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| i18n      | `t('subagents_snapshot')` returns expected string in `en` and `es`                     | `test/i18n.test.ts`                   |
| render    | English output `"Subagents: 1 run · 1 done · 0 err · Σ 2"` unchanged                   | `test/render.test.ts`                 |
| render    | Spanish output `"Subagentes: 1 act · 1 listo · 0 err · Σ 2"` (new)                     | `test/render.test.ts`                 |
| render    | `renderStatusSnapshotLine` produces `"Subagents snapshot: ..."` (no regex)             | `test/render.test.ts`                 |
| hydration | `hydrateSnapshotChild` defined in exactly one file                                     | `test/tui.test.ts` (extend)           |
| hydration | `buildSubagentSnapshotView` does not re-resolve `elapsedMs` when child already has one | `test/render.test.ts` (line 393 site) |

TDD order: failing Spanish test → add key → pass. Failing no-rehydration test → export helper →
remove duplicate → update callers → pass.

## Implementation Order

1. Add `subagents_snapshot` to `i18n.ts` (en + es)
2. Rewrite `renderAggregate` / `renderSnapshotAggregate` with `t()` — existing English assertions
   stay green
3. Add Spanish-locale test
4. Export `hydrateSnapshotChild` from `snapshot.ts`
5. Pre-hydrate in `renderStatusLine` and `renderStatusSnapshotLine`
6. Update direct test call at `test/render.test.ts:393`
7. Remove duplicate `hydrateSnapshotChild` from `snapshot-view.ts`
8. Run `vitest run` + `tsc --noEmit` from package root

Each step keeps the suite green.

## Risk Mitigation

| Risk                                                                        | Likelihood | Mitigation                                                                                                             |
| --------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| English i18n output drifts, breaks literal assertions                       | Medium     | Step 2 changes only substitution; `vitest run` catches immediately                                                     |
| Forgot to pre-hydrate in one of 3 callers → `elapsedMs` undefined           | Medium     | Every caller has a direct or indirect test; `formatDuration(undefined)` is covered                                     |
| `hydrateSnapshotChild` color diverges from `statusColor` in `format.ts:207` | Low        | Both call sites import the same `statusColor` — no new mapping                                                         |
| `buildSubagentSnapshotView` becomes a footgun (caller must pre-hydrate)     | Medium     | Spec scenario "buildTuiSnapshot path passes pre-hydrated children" enforces; test at line 393 demonstrates the pattern |

## Open Questions

None. Spec is concrete.
