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

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|---|---|---|---|---|---|
| Dead Code | 0 | 0 | 0 | 5 | 5 |
| Over-engineering | 0 | 5 | 1 | 0 | 6 |
| YAGNI | 0 | 0 | 4 | 0 | 4 |
| Clean Code | 5 | 1 | 3 | 2 | 11 |
| Simplification | 0 | 0 | 2 | 4 | 6 |
| Security | 0 | 0 | 0 | 3 | 3 |
| Error Handling | 1 | 2 | 3 | 0 | 6 |
| Performance | 0 | 0 | 0 | 0 | 0 |
| Architecture | 0 | 5 | 3 | 2 | 10 |
| Testing | 0 | 0 | 0 | 2 | 2 |
| Dependencies | 0 | 0 | 0 | 0 | 0 |
| Readability | 0 | 1 | 2 | 4 | 7 |
| SOLID | 0 | 1 | 1 | 1 | 3 |
| Observability | 1 | 5 | 1 | 0 | 7 |
| Data Integrity | 0 | 2 | 0 | 0 | 2 |
| Concurrency | 0 | 0 | 1 | 0 | 1 |
| Config Hygiene | 0 | 0 | 1 | 1 | 2 |
| Production Readiness | 0 | 0 | 1 | 4 | 5 |
| Consistency | 0 | 0 | 0 | 5 | 5 |
| Comments | 0 | 1 | 0 | 2 | 3 |
| **Total** | **7** | **22** | **21** | **38** | **88** |

---

## Task List

### 🔴 CRITICAL

- [ ] **CC-001** — `src/features/quota/infrastructure/providers/openai.ts:76` — `fetchOpenAIQuota` tiene 94 líneas con callbacks anidados (Promise.then), manejo de errores duplicado, y lógica de parseo inline. Extraer parseOpenAIResponse, fetchOpenAIUsage, y mantener solo el orquestador.
- [ ] **CC-002** — `src/features/subagent-status/domain/state/mutations.ts:143` — `upsertRunningChild` tiene 92 líneas con 7 helpers internos, 3 niveles de nesting, y lógica de estado, timestamps, tokens y purgado mezclado. Extraer resolveChildTiming, buildChildState.
- [ ] **CC-003** — `src/features/quota/ui/components/quota-section.tsx:60` — `fetchProviderLines` tiene 79 líneas con un switch de 6 cases, cada uno con fetch + parseo + formateo + errores replicados. Extraer fetchAndFormatXxx por provider.
- [ ] **CC-004** — `src/features/subagent-status/runtime/tui-runtime.ts:1` — Archivo de 228 líneas con 8 responsabilidades: clock, event bridge, persist queue, recovery, stale probes, session scope, bootstrap, dispose. Separar en TuiRuntimeConfig, TuiRuntimeOrchestrator, ClockAndTimers.
- [ ] **CC-005** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:258` — `decideRecoveredStatus` tiene 58 líneas con 6 ramas de decisión anidadas, comparaciones de timestamps y merge de tokens. Refactorizar a guard clauses con early return.
- [ ] **EH-001** — `src/features/subagent-status/runtime/events/bridge.ts:43` — Catch block vacío que traga errores al hacer unsubscribe de eventos. Agregar `console.warn('[agent-monitor] Failed to unsubscribe event:', ...)`.
- [ ] **OB-001** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:183` — Error de fetch silenciado en el path principal de refresco de subagentes. Si `sessionClient.listChildren()` falla, el catch vacío traga el error sin log. Agregar `console.warn('[agent-monitor] listChildren failed:', ...)`.

---

### 🟠 HIGH

#### Clean Code

- [ ] **CC-006** — `src/features/quota/domain/options.ts:37` — Comentario "ponytail:" en spanglish que no explica nada. Reemplazar por descripción clara.
- [ ] **CC-007** — `src/features/subagent-status/infrastructure/persistence.ts:326` — Archivo de 326 líneas con 10+ funciones exportadas que deberían ser privadas. Reducir exports públicos.

#### Over-engineering

- [ ] **OE-001** — `src/features/quota/domain/options.ts:149` — Interfaz `NumericQuotaOptions` (Pick de Partial) que solo se usa una vez. Inline el tipo directamente.
- [ ] **OE-002** — `src/features/quota/ui/components/tui-panel.tsx:11` — Componente `TuiPanel` es un wrapper de 7 líneas con un solo llamador. Inline el contenido en QuotaSection y eliminar archivo.
- [ ] **OE-003** — `src/features/subagent-status/runtime/events/bridge.ts:39` — try/catch en dispose para funciones que nunca lanzan. Eliminar el try/catch innecesario.
- [ ] **OE-004** — `src/kit/use-clock-ticker.ts:1` — Import desde `solid-js/dist/solid.js` forzando declaration module extra. Cambiar a `solid-js` y eliminar `solid-reactive.d.ts` (además es frágil — release minor de solid-js podría romperlo).
- [ ] **OE-005** — `src/features/subagent-status/runtime/options.ts:152` — `normalizeSubagentStatusPluginOptions` tiene 55 líneas de clamping repetitivo. Extraer helper `clampOption(value, fallback, min, max?)`.

#### Comments

- [ ] **CM-001** — `src/features/quota/infrastructure/providers/constants.ts:9` — Comentario sobre User-Agent de browser impersonation sin referencia a ticket. Agregar TODO con issue number.

#### Readability

- [ ] **RD-001** — `src/features/subagent-status/ui/format.ts:59` — `formatCompactTokenCount` y `formatSidebarTokenCount` son casi idénticas. Unificar en `formatTokenCount(value, options?)`.

#### SOLID

- [ ] **SD-001** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:386` — `resolveOpenCodeDatabasePath` asume path hardcodeado de Linux Desktop. No tener default, forzar ruta desde config.

#### Error Handling

- [ ] **EH-002** — `src/features/subagent-status/infrastructure/persistence.ts:284` — `loadState` con catch vacío que devuelve createEmptyState() sin log. Si el archivo está corrupto, el usuario pierde estado previo sin saberlo. Agregar `console.warn`.
- [ ] **EH-003** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:250` — El catch de refreshRunner muta `nextState.recovering = false` ANTES del syncState, dejando flag inconsistente si sync falla. Mover a finally, loggear stack trace completo.

#### Data Integrity

- [ ] **DI-001** — `src/kit/clone.ts:36` — `cloneState` no clona `purgedSessionIDs`, compartiendo referencia con estado original. Cuando `clearPurgedSession` muta in-place, corrompe el estado fuente. Agregar `purgedSessionIDs: { ...state.purgedSessionIDs }`.
- [ ] **DI-002** — `src/features/quota/infrastructure/retry-policy.ts:22` — `parseBackoffResetMs` usa threshold de 1.000.000.000 para distinguir epoch-seconds de epoch-milliseconds, pero timestamps en ms (~1.7T en 2026) también superan ese threshold, causando backoff que nunca expira. Cambiar threshold a `> 10_000_000_000`.

#### Observability

- [ ] **OB-002** — `src/features/subagent-status/runtime/tui-runtime.ts:104` — Transición running→error por hard-stale sin ningún log. Agregar `console.warn('[agent-monitor] hard-stale: marking', child.id, 'as error')`.
- [ ] **OB-003** — `src/features/quota/infrastructure/providers/auth.ts:76` — Fallo de decode JWT silenciado. Si el token de OpenAI está malformado, el catch traga el error. Agregar `console.warn`.
- [ ] **OB-004** — `src/features/subagent-status/infrastructure/sqlite/script.ts:94` — Fallo de parseo del output del script Python de recovery silenciado. Agregar `console.warn` con preview del stdout.
- [ ] **OB-005** — `src/features/subagent-status/infrastructure/config.ts:29` — Fallo de parseo de `agent-monitor.json` silenciado (solo en subagent-status; quota sí loggea). Agregar el mismo `console.warn` que usa quota.
- [ ] **OB-006** — `(multiple files)` — Ningún mensaje de log incluye correlation ID (session_id, trace_id). Debuggear sesiones específicas es imposible sin grep manual. Agregar `sessionId` a cada log en contexto de sesión.
- [ ] **OB-007** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:84` — Errores de orquestación loggeados solo con `e.message` en vez del error completo. Se pierde el stack trace. Pasar el error completo a `console.warn`.

#### Architecture

- [ ] **AR-001** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:1` — Archivo de 426 líneas con lógica excesivamente compleja. Separar recovery-classifier, map-recovered-child.
- [ ] **AR-002** — `src/features/subagent-status/runtime/refresh/hydrate.ts:1` — Archivo de 344 líneas que mezcla hidratación, análisis de mensajes y caché TUI. Separar message-activity.ts, hydrate-child.ts.
- [ ] **AR-003** — `src/features/subagent-status/domain/state/mutations.ts:1` — Archivo de 358 líneas con lógica densa. Extraer timing-policy.ts, replace.ts. Reemplazar JSON.stringify con comparación estructurada.
- [ ] **AR-004** — `src/features/subagent-status/infrastructure/persistence.ts:1` — Archivo de 326 líneas con 4+ responsabilidades. Separar en io.ts, load.ts, recovery.ts, queue.ts.
- [ ] **AR-005** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:1` — Archivo de 303 líneas con 6+ lambdas internas. Extraer events/merge.ts, refresh/token-backfill.ts.

---

### 🟡 MEDIUM

#### YAGNI

- [ ] **YG-001** — `prettier.config.mjs:54` — Plugins de Prettier comentados que no están en package.json. Eliminar bloque comentado.
- [ ] **YG-002** — `src/features/subagent-status/infrastructure/sqlite/script.ts:1` — Recovery desde SQLite vía `spawnSync('python3', ...)`. Dependencia externa frágil. Reemplazar con TypeScript puro.
- [ ] **YG-003** — `src/features/subagent-status/infrastructure/persistence.ts:94` — `resolveTextPath`, `resolveDebugPath`, `saveDebugSnapshot` exportados pero solo usados internamente. No exportar.
- [ ] **YG-004** — `src/features/subagent-status/domain/state/core.ts:65` — Re-exports de coercion.ts sin modificar. Eliminar, los consumidores ya importan directamente.

#### Clean Code

- [ ] **CC-008** — `src/features/subagent-status/ui/collapse.ts:70` — `collapseSubagentWorkItems` tiene 62 líneas con 2 loops anidados, Maps y Sets. Extraer groupSyntheticByParent, matchSyntheticToSession, deduplicateSyntheticTools.
- [ ] **CC-009** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:318` — `resolveRecoveredStatus` y `decideRecoveredStatus` forman una máquina de estados con 6+ ramas. Documentar con diagrama o simplificar.
- [ ] **CC-010** — `src/features/subagent-status/infrastructure/persistence.ts:326` — Cerca del límite de 400 líneas, 10+ funciones exportadas. Reducir exports.

#### Over-engineering

- [ ] **OE-006** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:148` — 4 funciones (153 líneas) para implementar un reducer de partes SQLite. Simplificar a un solo loop con 3 acumuladores.

#### Simplification

- [ ] **SM-001** — `src/features/quota/domain/lines.ts:42` — `resetAtMsFromSeconds` y `remainingSeconds` son funciones de una línea. Inline donde se usan.
- [ ] **SM-002** — `src/features/quota/domain/lines.ts:47` — `usageColor` duplicado como `toneColor` en `quota-view.tsx`. Unificar en un solo helper.

#### Error Handling

- [ ] **EH-004** — `src/features/subagent-status/runtime/session/scope.ts:23` — `void input.syncState(...)` fire-and-forget que pierde errores de persistencia. Agregar `.catch(console.warn)`.
- [ ] **EH-005** — `src/features/subagent-status/runtime/events/bridge.ts:34` — `void refresh()` fire-and-forget en cada evento. Agregar `.catch((e) => console.warn(...))`.
- [ ] **EH-006** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:235` — `nextState.recovering = false` antes de syncState. Mover a finally, incluir stack trace en log.

#### Concurrency

- [ ] **CN-001** — `src/features/subagent-status/runtime/events/bridge.ts:34` — `void refresh()` sin manejo de errores. Promesas lanzadas y olvidadas.

#### Config Hygiene

- [ ] **CF-001** — `src/features/quota/infrastructure/providers/constants.ts:1` — `FETCH_TIMEOUT_MS` hardcodeado a 10s. Exponer como opción configurable con fallback a 10.000ms.

#### Readability

- [ ] **RD-002** — `src/features/subagent-status/runtime/events/parse.ts:161` — `extractCreatedChild` tiene 25 líneas con cascada de campos de 4+ keys distintas. Agregar comentarios de sección o extraer extractChildCore + extractChildTimestamps.
- [ ] **RD-003** — `src/features/subagent-status/runtime/events/parse.ts:244` — `extractToolChild` tiene 38 líneas con 5+ niveles de extracción anidada. Separar validateToolPart, extractToolTitle, buildToolChild.

#### SOLID

- [ ] **SD-002** — `src/kit/coercion.ts:1` — Violación SRP: 16 funciones de 3 categorías (guards, coercers, nested path finders) en un archivo. Separar en guards.ts, coercers.ts, nested.ts.

#### Observability

- [ ] **OB-008** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:84` — Stack traces perdidos, solo se loggea `e.message`. Pasar error completo.

#### Architecture

- [ ] **AR-006** — `src/features/subagent-status/runtime/events/parse.ts:1` — Archivo de 349 líneas con 3 dominios distintos. Separar en events/extract.ts, events/extract-child.ts, events/resolve.ts.
- [ ] **AR-007** — `src/features/subagent-status/infrastructure/sqlite/recovery.py:1` — Script Python de 322 líneas duplicando lógica TypeScript. Reemplazar con TypeScript puro.
- [ ] **AR-008** — `src/kit/coercion.ts:4` — `isPlainObject as isRecord` en 13 archivos con semántica engañosa (excluye arrays). Cambiar a `isRecord` directo.

#### Production Readiness

- [ ] **PR-001** — `src/kit/use-slot-visibility.ts:26` — `undefined as unknown as JSX.Element` hack de tipos frágil. Revisar si el hook puede reemplazarse con createEffect + onCleanup directo.

---

### 🟢 LOW

#### Dead Code

- [ ] **DC-001** — `src/features/quota/domain/format.ts:60` — `formatOpenAIRateLimitTone` retorna `undefined` que nunca se usa efectivamente. Retornar `'neutral'` como default.
- [ ] **DC-002** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:48` — `createEmptyRecoveryResult` función de 4 líneas usada una vez. Convertir a constante `EMPTY_RECOVERY_RESULT`.
- [ ] **DC-003** — `src/features/subagent-status/domain/state/maintenance.ts:32` — `terminalChildTimestamp` es idéntica a `childEvidenceTimestampMs` (línea 29). Unificar.
- [ ] **DC-004** — `src/features/subagent-status/runtime/refresh/hydrate.ts:218` — `summarizeMessages` es wrapper de 1 línea. Eliminar, usar `analyzeMessages(messages).summary` directo.
- [ ] **DC-005** — `src/features/subagent-status/runtime/refresh/hydrate.ts:202` — `latestSessionActivityAt` no se importa en ningún otro archivo. Verificar uso o eliminar.
- [ ] **DC-006** — `src/features/subagent-status/domain/state/mutate-details.ts:81` — `mergeChildDetails` alias de `upsertChildDetails` que confunde. Eliminar alias.

#### Clean Code

- [ ] **CC-011** — `src/kit/coercion.ts:1` — 16 funciones exportadas, varias sin uso real (isPlainObject, normalizedString, timestampMs, safeTimestamp, timestampFromUnknown, firstDefined). Mantener solo las usadas.
- [ ] **CC-012** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:279` — `void tokenBackfillRunner(...)` fire-and-forget. Agregar `.catch()` al menos con console.warn.
- [ ] **CC-013** — `src/features/quota/infrastructure/providers/opencode-go.ts:76` — Array de windows sin `as const` literal. Agregar para garantizar inmutabilidad.

#### Simplification

- [ ] **SM-003** — `src/features/subagent-status/domain/tokens.ts:29` — `sameSubagentTokens` usa `JSON.stringify` para comparar objetos. Reemplazar con comparación campo a campo.
- [ ] **SM-004** — `src/features/subagent-status/domain/tokens.ts:5` — `isFiniteNumber` duplicado de `toFiniteNumber` en coercion.ts. Importar helper compartido.
- [ ] **SM-005** — `src/features/subagent-status/domain/state/core.ts:77` — `getCounts` itera con ifs separados. Usar `reduce` con objeto acumulador.
- [ ] **SM-006** — `src/features/subagent-status/runtime/events/parse.ts:62` — 12 `??` encadenados para buscar sessionID. Extraer helper `firstStringPath(event, paths)`.
- [ ] **SM-007** — `src/features/subagent-status/runtime/events/parse.ts:40` — `extractEventTimestamp` busca timestamps en 4+ fuentes con mismo patrón que hydrate.ts. Extraer helper compartido `findTimestamp`.

#### Security

- [ ] **SC-001** — `src/features/quota/infrastructure/providers/constants.ts:12` — User-Agent hardcodeado como browser impersonation. Podría violar términos de servicio. Documentar riesgo más explícitamente.
- [ ] **SC-002** — `src/features/quota/infrastructure/providers/auth.ts:72` — JWT de OpenAI parseado sin verificar firma. Al menos validar estructura mínima y campos esperados.
- [ ] **SC-003** — `src/kit/use-slot-visibility.ts:2` — Import desde ruta interna `solid-js/dist/solid.js`. Frágil ante cambios de estructura interna. Usar entry point `solid-js`.

#### Testing

- [ ] **TS-001** — `test/features/subagent-status/runtime.test.ts:1` — Archivo de 2123 líneas con tests repetitivos. Extraer helpers de test factory a fixture compartido.
- [ ] **TS-002** — `src/features/subagent-status/infrastructure/logs.ts:43` — Caché de tokens global mutable a nivel módulo. Puede causar interacciones entre tests. Resetear en beforeEach o inyectar dependencia.

#### Readability

- [ ] **RD-004** — `src/features/quota/domain/parse.ts:88` — `firstWindow` con 4 `||` encadenados para primary y 3 para secondary. Usar `parseWindowFromAliases` que ya existe.
- [ ] **RD-005** — `src/features/subagent-status/ui/view-model.ts:44` — `visibleSubagentWorkItems(sortedChildren)` en vez de `visibleSubagentWorkItems(collapsedChildren)`. Posible bug semántico. Revisar y documentar.
- [ ] **RD-006** — `src/features/subagent-status/ui/format.ts:11` — `formatRelativeRecency` con 6 ramas if/else. Considerar `Intl.RelativeTimeFormat`.
- [ ] **RD-007** — `src/features/subagent-status/runtime/boundaries.ts:1` — 4 secciones distintas en un archivo. Separar en event-payload.ts, route-params.ts, session-client.ts, slot-payload.ts.

#### SOLID

- [ ] **SD-003** — `src/features/subagent-status/domain/state/core.ts:96` — `isSyntheticToolWrapper` recibe `Partial<Pick<SubagentChild, 'source'>>` pero solo usa `child.source`. Simplificar a `(source: SubagentChild['source'])`.

#### Config Hygiene

- [ ] **CF-002** — `src/features/quota/infrastructure/providers/config.ts:31` / `src/features/subagent-status/infrastructure/config.ts:7` — Lógica de resolución de ruta de `agent-monitor.json` duplicada. Extraer a `src/kit/config-path.ts`.

#### Production Readiness

- [ ] **PR-002** — `test/runtime.test.ts:33` — `as unknown as MockApi` bypassea type safety. Usar `satisfies` o factory con verificación de campos.
- [ ] **PR-003** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:32` — Magic number `30 * 60_000` sin documentación de por qué 30 min. Agregar comentario: `// Sessions with no step-start abandoned after 30 min.`
- [ ] **PR-004** — `index.tsx:16` — `{} as unknown as TuiPluginMeta` casteo doble inseguro. Definir `const EMPTY_META: TuiPluginMeta = {};`.
- [ ] **PR-005** — `src/features/quota/infrastructure/providers/opencode-go.ts:44` — Regex para parsear HTML del dashboard, frágil ante cambios. Documentar: `// May break on dashboard redesign — test after OpenCode updates.`
- [ ] **PR-006** — `src/kit/coercion.ts:7` — `isPlainObject` vs `isRecord` diferencias sutiles (excluye arrays). Unificar o documentar semántica exacta.

#### Consistency

- [ ] **CS-001** — `src/features/quota/infrastructure/cache.ts:1` — Nombres en `Milliseconds` (sufijo completo) vs resto del proyecto en `Ms`. Uniformar a `Ms`.
- [ ] **CS-002** — `src/features/quota/domain/options.ts:1` — Mezcla `Ms` vs `Milliseconds` vs sin sufijo. Elegir convención y aplicar en todo el proyecto.
- [ ] **CS-003** — `src/features/subagent-status/infrastructure/persistence.ts:158` — `process.pid` en temp path, patrón único en el proyecto. randomUUID() solo alcanza.
- [ ] **CS-004** — `src/features/subagent-status/infrastructure/persistence.ts:40` — `isPersistedChildSource` y `isPersistedChildStatus` sin helper compartido de validación de rangos. Extraer `isOneOf<T>`.
- [ ] **CS-005** — `src/features/subagent-status/domain/session-status.ts:3` — `isPlainObject as isRecord` alias inconsistente con import directo de otros archivos. Unificar.

#### Comments

- [ ] **CM-002** — `src/features/quota/infrastructure/providers/openai.ts:172` — Comentario de re-export más largo que el código. Acortar a `// Re-exported for quota-section.tsx switch.`
- [ ] **CM-003** — `src/features/quota/infrastructure/retry-policy.ts:1` — `parseBackoffDelayMs` y `parseBackoffResetMs` sin docstring que explique diferencia. Agregar docstring breve.

#### Architecture

- [ ] **AR-009** — `src/features/subagent-status/shared/display.ts:5` — Estado mutable a nivel módulo (debugEnabled, doneTokenCache singleton). Inyectar como dependencia o documentar como singletons deliberados.
- [ ] **AR-010** — `src/features/subagent-status/domain/state/mutations.ts:253` — `JSON.stringify(state.children) !== JSON.stringify(nextState.children)` dependiente del orden de Object.entries, no garantizado. Usar comparación estructurada.

---

## Progress

- **CRITICAL**: `0 / 7`
- **HIGH**: `0 / 22`
- **MEDIUM**: `0 / 21`
- **LOW**: `0 / 38`
- **Total**: `0 / 88`

---

## Recommendations

1. **🔥 Crítica — Catch blocks silenciosos**: 4 hallazgos CRITICAL/HIGH en error-handling + observability donde errores se tragan sin logging (`bridge.ts:43`, `persistence.ts:284`, `orchestrator.ts:183`, `config.ts:29`). La prioridad máxima debería ser agregar logging con stack traces y correlation IDs en TODOS los catch vacíos. Esto solo cuesta ~30 líneas de cambios y elimina la mayor fuente de debugging imposible.

2. **🔥 Crítica — Funciones gigantes**: 5 hallazgos CRITICAL de clean-code son funciones de 50-94 líneas que incumplen la restricción de "archivos sin lógica muy compleja" (`openai.ts:76`, `mutations.ts:143`, `quota-section.tsx:60`, `tui-runtime.ts:1`, `hydrate.ts:258`). Extraer helpers por responsabilidad únicamente — cada una de estas funciones se puede reducir 50-70%.

3. **🔸 Alta — cloneState corrompe estado**: `clone.ts:36` no clona `purgedSessionIDs`, compartiendo referencia mutable. Cuando `clearPurgedSession` hace `delete` in-place sobre la referencia compartida, corrompe el estado fuente. Es un bug de data integrity que puede causar sesiones desaparecidas. Arreglo: 1 línea (`purgedSessionIDs: { ...state.purgedSessionIDs }`).

4. **🔸 Alta — Timestamp threshold bug**: `retry-policy.ts:22` usa threshold 1B para distinguir epoch-seconds (~1.7B) de epoch-milliseconds (~1.7T). En 2026 los ms > 1.7T también superan 1B, así que se multiplican por 1000 resultando en backoff que nunca expira (~56k años). Cambiar threshold a `10_000_000_000`.

5. **🔸 Alta — Fragmentación de archivos**: 5 archivos de arquitectura exceden las 300 líneas (hasta 426) con múltiples responsabilidades mezcladas. `persistence.ts`, `mutations.ts`, `hydrate.ts` (x2), `orchestrator.ts` necesitan separación en ~2-4 módulos cada uno. Esto va directo contra "una clase/responsabilidad por archivo".

6. **🔸 Media — Observabilidad**: 0 correlation IDs en logs, stack traces perdidos en todos los catch, 4 fallos de parseo/config silenciados distintos. Todo el sistema de monitoreo de subagentes no emite logs correlacionables, haciendo virtualmente imposible debuggear sesiones específicas en producción.

7. **🟢 Baja — Duplicación leve**: `isFiniteNumber` duplicado, `mergeChildDetails` alias inútil, `terminalChildTimestamp` idéntica a `childEvidenceTimestampMs`, `formatCompactTokenCount`/`formatSidebarTokenCount` casi idénticas, `isPlainObject` vs `isRecord` confuso. Son oportunidades de limpieza rápida de ~15 minutos.
