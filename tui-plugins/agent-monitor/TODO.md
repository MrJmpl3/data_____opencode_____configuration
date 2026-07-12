# Code Audit Results — `tui-plugins/agent-monitor/`

> Generado el 2026-07-10 por `gentle-orchestrator` con subagentes `review-readability`,
> `review-risk`, `review-reliability`, `review-resilience`

## Configuration

- **Path**: `/home/mrjmpl3/.config/opencode/tui-plugins/agent-monitor/`
- **Scope**: `tui-plugins/agent-monitor/` — 63 source files, 37 test files, 2 config files
- **Checks**: all (20)
- **Severity threshold**: low
- **Extra instructions**: Archivos sin lógica muy compleja, no extensos, una clase por archivo
- **Files analyzed**: ~102 archivos

---

## Summary

| Category             | CRITICAL | HIGH   | MEDIUM | LOW    | Total  |
| -------------------- | -------- | ------ | ------ | ------ | ------ |
| Dead Code            | 0        | 0      | 0      | 5      | 5      |
| Over-engineering     | 0        | 5      | 1      | 0      | 6      |
| YAGNI                | 0        | 0      | 4      | 0      | 4      |
| Clean Code           | 5        | 1      | 3      | 2      | 11     |
| Simplification       | 0        | 0      | 2      | 4      | 6      |
| Security             | 0        | 0      | 0      | 3      | 3      |
| Error Handling       | 1        | 2      | 3      | 0      | 6      |
| Performance          | 0        | 0      | 0      | 0      | 0      |
| Architecture         | 0        | 5      | 3      | 2      | 10     |
| Testing              | 0        | 0      | 0      | 2      | 2      |
| Dependencies         | 0        | 0      | 0      | 0      | 0      |
| Readability          | 0        | 1      | 2      | 4      | 7      |
| SOLID                | 0        | 1      | 1      | 1      | 3      |
| Observability        | 1        | 5      | 1      | 0      | 7      |
| Data Integrity       | 0        | 2      | 0      | 0      | 2      |
| Concurrency          | 0        | 0      | 1      | 0      | 1      |
| Config Hygiene       | 0        | 0      | 1      | 1      | 2      |
| Production Readiness | 0        | 0      | 1      | 4      | 5      |
| Consistency          | 0        | 0      | 0      | 5      | 5      |
| Comments             | 0        | 1      | 0      | 2      | 3      |
| **Total**            | **7**    | **22** | **22** | **38** | **89** |

---

## Task List

### 🔴 CRITICAL

- [x] **CC-001** — `src/features/quota/infrastructure/providers/openai.ts:76` — `fetchOpenAIQuota`
      tiene 94 líneas con callbacks anidados (Promise.then), manejo de errores duplicado, y lógica
      de parseo inline. Extraer parseOpenAIResponse, fetchOpenAIUsage, y mantener solo el
      orquestador. ✅ Fixed in this pass — extracted extractOpenAIUsageFields,
      resolveOpenAICreditsLabel, hasOpenAIUsagePayload; trimmed re-export comment (CM-002 too).
- [x] **CC-002** — `src/features/subagent-status/domain/state/mutations.ts:143` —
      `upsertRunningChild` tiene 92 líneas con 7 helpers internos, 3 niveles de nesting, y lógica de
      estado, timestamps, tokens y purgado mezclado. Extraer resolveChildTiming, buildChildState. ✅
      Fixed in this pass — extracted resolveChildTiming and buildChildState.
- [x] **CC-003** — `src/features/quota/ui/components/quota-section.tsx:60` — `fetchProviderLines`
      tiene 79 líneas con un switch de 6 cases, cada uno con fetch + parseo + formateo + errores
      replicados. Extraer fetchAndFormatXxx por provider. ✅ Fixed in this pass — extracted
      fetchAndFormatStandard/NoTick + 5 per-provider fetchAndFormatXxx helpers.
- [x] **CC-004** — `src/features/subagent-status/runtime/tui-runtime.ts:1` — Archivo de 228 líneas
      con 8 responsabilidades: clock, event bridge, persist queue, recovery, stale probes, session
      scope, bootstrap, dispose. Separar en TuiRuntimeConfig, TuiRuntimeOrchestrator,
      ClockAndTimers. ✅ Fixed in this pass — split into tui-runtime-config.ts (config builder with
      persist queue + recovery sources + policy) and tui-runtime.ts (orchestrator).
- [x] **CC-005** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:258` —
      `decideRecoveredStatus` tiene 58 líneas con 6 ramas de decisión anidadas, comparaciones de
      timestamps y merge de tokens. Refactorizar a guard clauses con early return. ✅ Fixed in this
      pass — extracted decideAmbiguousStatus helper, all branches now early-return guards.
- [x] **EH-001** — `src/features/subagent-status/runtime/events/bridge.ts:43` — Catch block vacío
      que traga errores al hacer unsubscribe de eventos. Agregar
      `console.warn('[agent-monitor] Failed to unsubscribe event:', ...)`. ✅ Already fixed before
      this pass
- [x] **OB-001** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:183` — Error de
      fetch silenciado en el path principal de refresco de subagentes. Si
      `sessionClient.listChildren()` falla, el catch vacío traga el error sin log. Agregar
      `console.warn('[agent-monitor] listChildren failed:', ...)`. ✅ Already fixed before this pass

---

### 🟠 HIGH

#### Clean Code

- [x] **CC-006** — `src/features/quota/domain/options.ts:37` — Comentario "ponytail:" en spanglish
      que no explica nada. Reemplazar por descripción clara. ✅ Already fixed before this pass
- [x] **CC-007** — `src/features/subagent-status/infrastructure/persistence.ts:326` — Archivo de 326
      líneas con 10+ funciones exportadas que deberían ser privadas. Reducir exports públicos. ✅
      Already fixed before this pass — file split into persistence/{io,load,recovery,queue}.ts and
      the remaining public surface is 7 actively-used exports.

#### Over-engineering

- [x] **OE-001** — `src/features/quota/domain/options.ts:149` — Interfaz `NumericQuotaOptions` (Pick
      de Partial) que solo se usa una vez. Inline el tipo directamente. ✅ Already fixed before this
      pass
- [x] **OE-002** — `src/features/quota/ui/components/tui-panel.tsx:11` — Componente `TuiPanel` es un
      wrapper de 7 líneas con un solo llamador. Inline el contenido en QuotaSection y eliminar
      archivo. ✅ Already fixed before this pass
- [ ] **OE-003** — `src/features/subagent-status/runtime/events/bridge.ts:39` — try/catch en dispose
      para funciones que nunca lanzan. Eliminar el try/catch innecesario. ✅ N/A — audit shows the
      try/catch is defensible: we cannot guarantee every OpenCode `subscribe` implementation never
      throws, and the existing `[agent-monitor] Failed to unsubscribe event:` log added by the
      CRITICAL pass makes the catch useful when an unsubscribe does fail. Kept intentionally.
- [x] **OE-004** — `src/kit/use-clock-ticker.ts:1` — Import desde `solid-js/dist/solid.js` forzando
      declaration module extra. Cambiar a `solid-js` y eliminar `solid-reactive.d.ts` (además es
      frágil — release minor de solid-js podría romperlo). ✅ Already fixed before this pass
- [x] **OE-005** — `src/features/subagent-status/runtime/options.ts:152` —
      `normalizeSubagentStatusPluginOptions` tiene 55 líneas de clamping repetitivo. Extraer helper
      `clampOption(value, fallback, min, max?)`. ✅ Already fixed before this pass

#### Comments

- [x] **CM-001** — `src/features/quota/infrastructure/providers/constants.ts:9` — Comentario sobre
      User-Agent de browser impersonation sin referencia a ticket. Agregar TODO con issue number. ✅
      Fixed in this pass — replaced `TODO(doc)` with the project-greppable `TODO(compliance-review)`
      marker and explained the placeholder convention.

#### Readability

- [x] **RD-001** — `src/features/subagent-status/ui/format.ts:59` — `formatCompactTokenCount` y
      `formatSidebarTokenCount` son casi idénticas. Unificar en `formatTokenCount(value, options?)`.
      ✅ Already fixed before this pass — `formatTokenCount(value, { unit? })` is the single helper;
      the per-context wrappers differ only in unit.

#### SOLID

- [x] **SD-001** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:386` —
      `resolveOpenCodeDatabasePath` asume path hardcodeado de Linux Desktop. No tener default,
      forzar ruta desde config. ✅ Already fixed before this pass — function and hardcoded path
      removed; `sqliteDatabasePath` flows from config straight to the recovery source.

#### Error Handling

- [x] **EH-002** — `src/features/subagent-status/infrastructure/persistence.ts:284` — `loadState`
      con catch vacío que devuelve createEmptyState() sin log. Si el archivo está corrupto, el
      usuario pierde estado previo sin saberlo. Agregar `console.warn`. ✅ Already fixed before this
      pass
- [x] **EH-003** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:250` — El catch de
      refreshRunner muta `nextState.recovering = false` ANTES del syncState, dejando flag
      inconsistente si sync falla. Mover a finally, loggear stack trace completo. ✅ Already fixed
      before this pass — `recovering = false` is in a `finally` block (orchestrator.ts:269-275) and
      the catch logs the full error.

#### Data Integrity

- [x] **DI-001** — `src/kit/clone.ts:36` — `cloneState` no clona `purgedSessionIDs`, compartiendo
      referencia con estado original. Cuando `clearPurgedSession` muta in-place, corrompe el estado
      fuente. Agregar `purgedSessionIDs: { ...state.purgedSessionIDs }`. ✅ Already fixed before
      this pass
- [x] **DI-002** — `src/features/quota/infrastructure/retry-policy.ts:22` — `parseBackoffResetMs`
      usa threshold de 1.000.000.000 para distinguir epoch-seconds de epoch-milliseconds, pero
      timestamps en ms (~1.7T en 2026) también superan ese threshold, causando backoff que nunca
      expira. Cambiar threshold a `> 10_000_000_000`. ✅ Already fixed before this pass

#### Observability

- [x] **OB-002** — `src/features/subagent-status/runtime/tui-runtime.ts:104` — Transición
      running→error por hard-stale sin ningún log. Agregar
      `console.warn('[agent-monitor] hard-stale: marking', child.id, 'as error')`. ✅ Already fixed
      before this pass — log lives in `markHardStaleRunningChildren`
      (domain/state/maintenance.ts:241) which is the right seam.
- [x] **OB-003** — `src/features/quota/infrastructure/providers/auth.ts:76` — Fallo de decode JWT
      silenciado. Si el token de OpenAI está malformado, el catch traga el error. Agregar
      `console.warn`. ✅ Already fixed before this pass
- [x] **OB-004** — `src/features/subagent-status/infrastructure/sqlite/script.ts:94` — Fallo de
      parseo del output del script Python de recovery silenciado. Agregar `console.warn` con preview
      del stdout. ✅ Fixed in this pass — log already existed; added a 200-char `stdoutPreview=` to
      the message so the raw recovery output is greppable next to the failure.
- [x] **OB-005** — `src/features/subagent-status/infrastructure/config.ts:29` — Fallo de parseo de
      `agent-monitor.json` silenciado (solo en subagent-status; quota sí loggea). Agregar el mismo
      `console.warn` que usa quota. ✅ Fixed in this pass — subagent-status already had the warn;
      aligned quota's `e.message` → full Error so both files use the same canonical format.
- [x] **OB-006** — `(multiple files)` — Ningún mensaje de log incluye correlation ID (session_id,
      trace_id). Debuggear sesiones específicas es imposible sin grep manual. Agregar `sessionId` a
      cada log en contexto de sesión. ✅ Fixed in this pass — pragmatic 4-site pass: added
      `sessionId=` to orchestrator.ts:clone-failure, tui-runtime.ts:bootstrap,
      scope.ts:persistEmpty, persistence.ts:loadState. The bridge keeps its existing "spans every
      session" comment.
- [x] **OB-007** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:84` — Errores de
      orquestación loggeados solo con `e.message` en vez del error completo. Se pierde el stack
      trace. Pasar el error completo a `console.warn`. ✅ Already fixed before this pass — every
      orchestrator catch passes the full Error object, not just the message.

#### Architecture

- [x] **AR-001** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:1` — Archivo de
      426 líneas con lógica excesivamente compleja. Separar recovery-classifier,
      map-recovered-child. ✅ Already fixed before this pass — `recovery-classifier.ts` and
      `map-recovered-child.ts` already exist; hydrate.ts is now 65 lines of glue.
- [x] **AR-002** — `src/features/subagent-status/runtime/refresh/hydrate.ts:1` — Archivo de 344
      líneas que mezcla hidratación, análisis de mensajes y caché TUI. Separar message-activity.ts,
      hydrate-child.ts. ✅ Already fixed before this pass — `message-activity.ts`,
      `hydrate-child.ts`, and `hydrate-client.ts` already extracted; hydrate.ts is the small surface
      remaining.
- [x] **AR-003** — `src/features/subagent-status/domain/state/mutations.ts:1` — Archivo de 358
      líneas con lógica densa. Extraer timing-policy.ts, replace.ts. Reemplazar JSON.stringify con
      comparación estructurada. ✅ Fixed in this pass — extracted `timing-policy.ts`
      (resolveChildTiming, computeTimingPreservation, shouldReopenTerminal,
      shouldPreserveSameTerminalTiming, isStaleEvidence, isKnownStatus, resolveIncomingStatus,
      resolveSourceForUpsert) and `replace.ts` (replaceChildren). The two `JSON.stringify`
      comparisons were already gone — `hasChildFieldChanges` is a 12-field structured compare.
- [x] **AR-004** — `src/features/subagent-status/infrastructure/persistence.ts:1` — Archivo de 326
      líneas con 4+ responsabilidades. Separar en io.ts, load.ts, recovery.ts, queue.ts. ✅ Fixed in
      this pass — split into `persistence/{io,load,recovery,queue}.ts` and a thin re-export shim
      preserves the public API.
- [x] **AR-005** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:1` — Archivo de 303
      líneas con 6+ lambdas internas. Extraer events/merge.ts, refresh/token-backfill.ts. ✅ Fixed
      in this pass — extracted `events/merge.ts` (createMergeEventState) and
      `refresh/token-backfill.ts` (createTokenBackfillRunner + fireAndForget helper).

---

### 🟡 MEDIUM

- [x] **YG-001** — FIXED: removed the stale commented plugin block.
- [x] **YG-002** — FIXED: recovery uses built-in `node:sqlite`; no Python process.
- [x] **YG-003** — FIXED: persistence shim exports only its consumed public API.
- [x] **YG-004** — FIXED: removed pass-through coercion exports from state core.
- [x] **CC-008** — FIXED: extracted grouping, matching, and tool-deduplication helpers.
- [x] **CC-009** — ALREADY FIXED: extracted classifier documents evidence priority and stale guards.
- [x] **CC-010** — ALREADY FIXED: persistence is a 15-line shim over focused modules.
- [x] **OE-006** — ALREADY FIXED: prior split replaced the stale four-function hydrate
      implementation.
- [x] **SM-001** — FIXED: inlined trivial reset-time calculations.
- [x] **SM-002** — FIXED: unified quota colors in `quotaColor`.
- [x] **EH-004** — ALREADY FIXED: scoped persistence has a handled rejection with full error.
- [x] **EH-005** — FIXED: event refresh rejection is handled once in the bridge.
- [x] **EH-006** — ALREADY FIXED: recovery flag cleanup is in `finally` and logs full errors.
- [x] **CN-001** — FIXED with EH-005 at the shared fire-and-forget boundary.
- [x] **CF-001** — FIXED: `fetchTimeoutMs` flows from config to every provider with a 10,000ms
      fallback.
- [x] **RD-002** — FIXED: extracted `extractChildCore` and `extractChildTimestamps`.
- [x] **RD-003** — FIXED: extracted `validateToolPart`, `extractToolTitle`, and `buildToolChild`.
- [x] **SD-002** — FIXED: split guards, coercers, and nested readers behind a compatibility shim.
- [x] **OB-008** — ALREADY FIXED: orchestrator logs full `Error` values.
- [x] **AR-006** — FIXED: split raw extraction, child construction, and resolution into dedicated
      modules; `parse.ts` remains a compatibility re-export shim.
- [x] **AR-007** — FIXED: deleted `recovery.py` and Python test plumbing.
- [x] **AR-008** — FIXED: `isRecord` and `isPlainObject` now have separate exact implementations.

#### Production Readiness

- [x] **PR-001** — `src/kit/use-slot-visibility.ts:26` — `null as unknown as JSX.Element` hack de
      tipos frágil. Revisar si el hook puede reemplazarse con createEffect + onCleanup directo. ✅
      N/A — The SolidJS slot registration API requires a `JSX.Element` return type. The current
      pattern is documented as intentional (`"SlotProvider is never actually rendered"`) and is the
      standard way to wire visibility through Solid's render lifecycle without rendering DOM.

---

### 🟢 LOW

#### Dead Code

- [x] **DC-001** — `src/features/quota/domain/format.ts:46` — `formatOpenAIRateLimitTone` ya retorna
      `'neutral'` como default (línea 49). ✅ Ya estaba corregido antes de este pase.
- [x] **DC-002** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:51` —
      `createEmptyRecoveryResult` ya es la constante `EMPTY_RECOVERY_RESULT`. ✅ Ya estaba
      corregido.
- [x] **DC-003** — `src/features/subagent-status/domain/state/maintenance.ts:29` —
      `terminalChildTimestamp` no existe; solo `childEvidenceTimestampMs`. ✅ Ya unificado.
- [x] **DC-004** — `src/features/subagent-status/runtime/refresh/hydrate.ts` — `summarizeMessages`
      ya no existe; hydrate.ts es un shim de re-export. ✅ Split previo.
- [x] **DC-005** — `src/features/subagent-status/runtime/refresh/hydrate.ts:202` —
      `latestSessionActivityAt` no tenía consumidores. Se eliminó del re-export en hydrate.ts. La
      definición permanece en message-activity.ts. ✅ Fixed in this pass.
- [x] **DC-006** — `src/features/subagent-status/domain/state/mutate-details.ts` —
      `mergeChildDetails` no existe; solo `upsertChildDetails`. ✅ Ya eliminado en split previo.

#### Clean Code

- [x] **CC-011** — `src/kit/coercion.ts:1` — 16 funciones exportadas, varias sin uso real
      (isPlainObject, normalizedString, timestampMs, safeTimestamp, timestampFromUnknown,
      firstDefined). Mantener solo las usadas. ✅ N/A — All 15 barrel exports have consumers in
      production or test code. `isPlainObject` is tested in coercion.test.ts; the rest are used
      across 20+ files. The barrel was already split into guards.ts/coercers.ts/nested.ts by a
      previous pass.
- [x] **CC-012** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:279` —
      `tokenBackfill.fireAndForget()` ya maneja errores internamente con `.catch()` + `console.warn`
      en `token-backfill.ts:62-73`. ✅ Ya estaba corregido.
- [x] **CC-013** — `src/features/quota/infrastructure/providers/opencode-go.ts:84` — Array de
      windows ya tiene `as const`. ✅ Ya estaba corregido.

#### Simplification

- [x] **SM-003** — `src/features/subagent-status/domain/tokens.ts:30` — `sameSubagentTokens` ya usa
      comparación campo a campo (`===`). ✅ Ya estaba corregido.
- [x] **SM-004** — `src/features/subagent-status/domain/tokens.ts:5` — `isFiniteNumber` marcado
      `@deprecated` con docstring apuntando a `toFiniteNumber`. Se mantiene por uso interno en el
      mismo archivo (3 callers). ✅ Deprecation marker presente.
- [x] **SM-005** — `src/features/subagent-status/domain/state/core.ts:75` — `getCounts` ya usa
      `reduce` con objeto acumulador. ✅ Ya estaba corregido.
- [x] **SM-006** — `src/features/subagent-status/runtime/events/extract.ts:48` — 11 `??` encadenados
      para buscar sessionID. Extraer helper `firstStringPath(event, paths)`. ✅ Fixed in this pass —
      refactored `extractSessionId` to use the existing `firstDefined` helper, replacing the `??`
      chain with declarative `firstDefined(...asString(...)...)`.
- [x] **SM-007** — `src/features/subagent-status/runtime/events/parse.ts:40` —
      `extractEventTimestamp` busca timestamps en 4+ fuentes con mismo patrón que hydrate.ts.
      Extraer helper compartido `findTimestamp`. ✅ N/A — `extractEventTimestamp` is already a
      shared helper in `extract.ts`. `hydrate.ts` uses it from there via `timestampFromUnknown`. The
      initial finding predated the split of parse.ts into extract.ts/extract-child.ts/resolve.ts.

#### Security

- [x] **SC-001** — `src/features/quota/infrastructure/providers/constants.ts:9-12` — User-Agent ya
      documenta explícitamente: `WARNING: impersonating a browser may violate provider ToS.` +
      `TODO(compliance-review)`. ✅ Ya documentado.
- [x] **SC-002** — `src/features/quota/infrastructure/providers/auth.ts:68-84` — JWT ya validado: 3
      partes, header con `alg`, payload como record. Comentario explica por qué se omite la
      verificación de firma (token local, solo se lee `chatgpt_account_id`). ✅ Ya validado.
- [x] **SC-003** — `src/kit/use-slot-visibility.ts:2` — Import ya usa `solid-js`, no
      `solid-js/dist/solid.js`. ✅ Ya corregido en pase previo (OE-004).

#### Testing

- [x] **TS-001** — ✅ Extracted `createMockApi()` to
      `test/features/subagent-status/fixtures/mock-api.ts`; applied to 4 bootstrapping tests.
- [x] **TS-002** — ✅ Exported `resetDoneTokenCache()` that replaces module-scoped cache bindings
      with fresh instances. Called in `logs.test.ts` `beforeEach` and `runtime.test.ts` `afterEach`.

#### Readability

- [x] **RD-004** — `src/features/quota/domain/parse.ts:88` — `firstWindow` con 4 `||` encadenados
      para primary y 3 para secondary. Usar `parseWindowFromAliases` que ya existe. ✅ N/A —
      `parseWindowFromAliases` has a fallback `return parseOpenAIWindow(value)` that would
      incorrectly assign the whole record to both primary AND secondary lookups. The `firstWindow`
      pattern deliberately separates the two and only falls back once.
- [x] **RD-005** — `src/features/subagent-status/ui/view-model.ts:50` —
      `visibleSubagentWorkItems(collapsedChildren)` — el código actual pasa `collapsedChildren`
      correctamente. La variable `sortedChildren` no existe en el código actual; el sorting es
      inline en `collapseSubagentWorkItems`. ✅ Sin bug.
- [x] **RD-006** — `src/features/subagent-status/ui/format.ts:11` — `formatRelativeRecency` con 6
      ramas if/else. Considerar `Intl.RelativeTimeFormat`. ✅ N/A — `Intl.RelativeTimeFormat`
      produces different output (e.g. "5 seconds ago" vs. compact "5s ago"). The existing compact
      format is intentional for sidebar space constraints. 6 branches are clear and stable.
- [x] **RD-007** — `src/features/subagent-status/runtime/boundaries.ts:1` — 4 secciones distintas en
      un archivo. Separar en event-payload.ts, route-params.ts, session-client.ts, slot-payload.ts.
      ✅ N/A — `boundaries.ts` no longer exists. Was already split into the four target files plus
      `session-client.ts` and `slot-payload.ts` by a previous pass.

#### SOLID

- [x] **SD-003** — `src/features/subagent-status/domain/state/core.ts:93` — `isSyntheticToolWrapper`
      ya recibe `source: SubagentChild['source']` directamente. ✅ Ya simplificado.

#### Config Hygiene

- [x] **CF-002** — Ambos archivos ya importan `configFilePath()` desde `src/kit/config-path.ts`.
      Lógica duplicada extraída al kit compartido. ✅ Ya extraído.

#### Production Readiness

- [x] **PR-002** — `test/runtime.test.ts:33` — `as unknown as MockApi` bypassea type safety. Usar
      `satisfies` o factory con verificación de campos. ✅ N/A — `MockApi` intentionally extends
      `TuiPluginApi` with a `handlers` property absent from the source type. `satisfies` cannot add
      extra fields. The existing comment documents the pattern. Fixing this would require changing
      the test strategy or the API type, both out of scope for this pass.
- [x] **PR-003** — `src/features/subagent-status/domain/state/maintenance.ts:196` — El comentario
      `// Sessions with no step-start abandoned after 30 min.` ya existe sobre la constante
      `TERMINAL_CHILD_RETENTION_MS`. ✅ Ya documentado.
- [x] **PR-004** — `index.tsx:14` — `{} as unknown as TuiPluginMeta` casteo doble inseguro. ✅ Fixed
      in this final pass — `TuiPluginMeta` requires 10 required fields (`id`, `source`, `spec`,
      `target`, `first_time`, `last_time`, `time_changed`, `load_count`, `fingerprint`, `state`), so
      `const EMPTY_META: TuiPluginMeta = {};` fails typecheck (TS-2741). Replaced with a fully-typed
      constant providing sane defaults — zero type-unsafe expressions.
- [x] **PR-005** — `src/features/quota/infrastructure/providers/opencode-go.ts:44` — El comentario
      `// May break on dashboard redesign — test after OpenCode updates.` ya existe. ✅ Ya
      documentado.
- [x] **PR-006** — `src/kit/coercion.ts:7` — `isPlainObject` vs `isRecord` diferencias sutiles
      (excluye arrays). Unificar o documentar semántica exacta. ✅ N/A — The semantic difference is
      explicit in the function names and implementation: `isRecord` allows arrays, `isPlainObject`
      excludes them. Test coverage in `coercion.test.ts` validates the distinction. Unifying would
      break existing usage where callers rely on the difference.

#### Consistency

- [x] **CS-001** — `src/features/quota/infrastructure/cache.ts:1` — Nombres en `Milliseconds`
      (sufijo completo) vs resto del proyecto en `Ms`. Uniformar a `Ms`. ✅ Fixed in this pass —
      renamed all `Milliseconds` suffix → `Ms` throughout cache.ts + updated callers in
      quota-section.tsx and cache.test.ts. The all-caps constant `MAX_PROVIDER_BACKOFF_MILLISECONDS`
      was also renamed to `MAX_PROVIDER_BACKOFF_MS`.
- [x] **CS-002** — `src/features/quota/domain/options.ts:1` — Mezcla `Ms` vs `Milliseconds` vs sin
      sufijo. Elegir convención y aplicar en todo el proyecto. ✅ N/A — `options.ts` already
      consistently uses `Ms` suffix (`MIN_SAFE_REFRESH_INTERVAL_MS`,
      `DEFAULT_PROVIDER_CACHE_TTL_MS`, etc.). The finding predated the normalization done by
      previous passes.
- [x] **CS-003** — `src/features/subagent-status/infrastructure/persistence/io.ts:49` —
      `process.pid` no está presente; `writeLocalFile` usa `randomUUID()` para temp paths. ✅ Ya
      corregido en split previo.
- [x] **CS-004** — `src/kit/coercers.ts:45` — `isOneOf<T>` existe y se usa en
      `persistence/load.ts:26-29` para `isPersistedChildSource`/`isPersistedChildStatus`. ✅ Ya
      extraído.
- [x] **CS-005** — `src/features/subagent-status/domain/session-status.ts:3` — Importa `isRecord`
      directamente desde `coercion.ts`, sin alias. ✅ Ya unificado.

#### Comments

- [x] **CM-002** — `src/features/quota/infrastructure/providers/openai.ts:225` — Comentario ya es
      `// Re-exported for quota-section.tsx switch.` ✅ Ya acortado.
- [x] **CM-003** — `src/features/quota/infrastructure/retry-policy.ts:1,18` — `parseBackoffDelayMs`
      documentado como "ms to wait BEFORE retrying" y `parseBackoffResetMs` como "ms until the
      rate-limit RESET". ✅ Ya documentados.

#### Architecture

- [x] **AR-009** — `src/features/subagent-status/shared/display.ts:5` — Estado mutable a nivel
      módulo (debugEnabled, doneTokenCache singleton). Inyectar como dependencia o documentar como
      singletons deliberados. ✅ N/A — Already documented as intentional via a block comment: "Debug
      state is intentionally module-level (not instance-scoped) because the debug flag is set once
      at startup via plugin options and never changes mid-session. A factory would add indirection
      without benefit." The `doneTokenCache` was moved to `logs.ts` in a prior pass.
- [x] **AR-010** — `src/features/subagent-status/domain/state/mutations.ts:94` —
      `hasChildFieldChanges` usa comparación estructurada de 12 campos (`===` + `sameTokens`), no
      `JSON.stringify`. ✅ Ya corregido en AR-003.

---

## Progress

- **CRITICAL**: `7 / 7`
- **HIGH**: `22 / 22`
- **MEDIUM**: `23 / 23`
- **LOW**: `38 / 38`
- **Total**: `88 / 90`

---

## Recommendations

1. **🔥 Crítica — Catch blocks silenciosos**: 4 hallazgos CRITICAL/HIGH en error-handling +
   observability donde errores se tragan sin logging (`bridge.ts:43`, `persistence.ts:284`,
   `orchestrator.ts:183`, `config.ts:29`). La prioridad máxima debería ser agregar logging con stack
   traces y correlation IDs en TODOS los catch vacíos. Esto solo cuesta ~30 líneas de cambios y
   elimina la mayor fuente de debugging imposible.

2. **🔥 Crítica — Funciones gigantes**: 5 hallazgos CRITICAL de clean-code son funciones de 50-94
   líneas que incumplen la restricción de "archivos sin lógica muy compleja" (`openai.ts:76`,
   `mutations.ts:143`, `quota-section.tsx:60`, `tui-runtime.ts:1`, `hydrate.ts:258`). Extraer
   helpers por responsabilidad únicamente — cada una de estas funciones se puede reducir 50-70%.

3. **🔸 Alta — cloneState corrompe estado**: `clone.ts:36` no clona `purgedSessionIDs`, compartiendo
   referencia mutable. Cuando `clearPurgedSession` hace `delete` in-place sobre la referencia
   compartida, corrompe el estado fuente. Es un bug de data integrity que puede causar sesiones
   desaparecidas. Arreglo: 1 línea (`purgedSessionIDs: { ...state.purgedSessionIDs }`).

4. **🔸 Alta — Timestamp threshold bug**: `retry-policy.ts:22` usa threshold 1B para distinguir
   epoch-seconds (~1.7B) de epoch-milliseconds (~1.7T). En 2026 los ms > 1.7T también superan 1B,
   así que se multiplican por 1000 resultando en backoff que nunca expira (~56k años). Cambiar
   threshold a `10_000_000_000`.

5. **🔸 Alta — Fragmentación de archivos**: 5 archivos de arquitectura exceden las 300 líneas
   (hasta 426) con múltiples responsabilidades mezcladas. `persistence.ts`, `mutations.ts`,
   `hydrate.ts` (x2), `orchestrator.ts` necesitan separación en ~2-4 módulos cada uno. Esto va
   directo contra "una clase/responsabilidad por archivo".

6. **🔸 Media — Observabilidad**: 0 correlation IDs en logs, stack traces perdidos en todos los
   catch, 4 fallos de parseo/config silenciados distintos. Todo el sistema de monitoreo de
   subagentes no emite logs correlacionables, haciendo virtualmente imposible debuggear sesiones
   específicas en producción.

7. **🟢 Baja — Duplicación leve**: `isFiniteNumber` duplicado, `mergeChildDetails` alias inútil,
   `terminalChildTimestamp` idéntica a `childEvidenceTimestampMs`,
   `formatCompactTokenCount`/`formatSidebarTokenCount` casi idénticas, `isPlainObject` vs `isRecord`
   confuso. Son oportunidades de limpieza rápida de ~15 minutos.
