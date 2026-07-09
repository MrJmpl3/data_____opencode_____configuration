# Code Audit Results — `tui-plugins/agent-monitor/`

> Generado el 2026-07-09 por `gentle-orchestrator` con subagentes `review-readability`,
> `review-risk`, `review-reliability`, `review-resilience`

## Configuration

- **Path**: `/home/mrjmpl3/.config/opencode/tui-plugins/agent-monitor/`
- **Scope**: `src/`, `test/`, root config files
- **Checks**: all (20 dimensiones)
- **Severity threshold**: LOW (todos los niveles)
- **Extra instructions**: Files should not have excessive complexity or length, and one class per file.
- **Files analyzed**: ~110 (75 source + 35 test + config)

---

## Summary

| Category          | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-------------------|----------|------|--------|-----|-------|
| Dead Code         | 0        | 2    | 0      | 0   | 2     |
| Over-engineering  | 0        | 0    | 0      | 0   | 0     |
| YAGNI             | 0        | 0    | 1      | 0   | 1     |
| Clean Code        | 0        | 5    | 3      | 0   | 8     |
| Simplification    | 0        | 0    | 1      | 0   | 1     |
| Security          | 0        | 1    | 0      | 1   | 2     |
| Error Handling    | 0        | 3    | 3      | 1   | 7     |
| Performance       | 0        | 0    | 2      | 3   | 5     |
| Architecture      | 0        | 1    | 2      | 2   | 5     |
| Testing           | 1        | 0    | 2      | 2   | 5     |
| Dependencies      | 0        | 0    | 1      | 2   | 3     |
| Consistency       | 0        | 0    | 0      | 0   | 0     |
| Comments          | 0        | 1    | 0      | 1   | 2     |
| Readability       | 0        | 0    | 0      | 1   | 1     |
| SOLID             | 0        | 0    | 0      | 0   | 0     |
| Observability     | 4        | 4    | 5      | 4   | 17    |
| Data Integrity    | 0        | 0    | 2      | 1   | 3     |
| Concurrency       | 0        | 0    | 2      | 1   | 3     |
| Config Hygiene    | 0        | 0    | 0      | 4   | 4     |
| Production Ready  | 1        | 0    | 0      | 0   | 1     |
| **Total**         | **6**    | **17** | **24** | **23** | **70** |

---

## Task List

### 🔴 CRITICAL

- [x] **TS-001** — `vitest.config.ts:1` — Añadido `allowOnly: false` — ahora falla si hay `it.only` committed.
- [x] **PR-001** — `src/features/subagent-status/infrastructure/sqlite/script.ts:334` — Eliminado `open("/tmp/subagent-recovery-ran.txt", "w").close()`.
- [x] **OB-001** — `src/features/quota/infrastructure/providers/auth.ts:19` — Añadido `console.warn` con mensaje de error.
- [x] **OB-002** — `src/features/quota/infrastructure/providers/config.ts:126` — Añadido `console.warn` con mensaje de error.
- [x] **OB-003** — `src/features/subagent-status/infrastructure/persistence.ts:258` — Añadido `console.warn` con mensaje de error.
- [x] **OB-004** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:242` — Añadido `console.warn` con mensaje de error.

### 🟠 HIGH

#### Dead Code

- [x] **DC-001** — `src/features/subagent-status/runtime/refresh/hydrate.ts:36` — Eliminado tipo `HydrationStrategy` sin uso.
- [x] **DC-002** — `src/features/quota/infrastructure/providers/openai.ts:176` — Eliminados 6 re-exports muertos; solo queda `formatOpenAILines`.

#### Clean Code

- [x] **CC-001** — `src/features/subagent-status/domain/state/mutations.ts:65` — `upsertRunningChild` extraído en 7 helpers, 120→84 líneas.
- [x] **CC-002** — `src/features/subagent-status/infrastructure/persistence.ts:104` — `loadState` dividido en 5 helpers, ~130→~15 líneas de orquestación.
- [x] **CC-003** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:100` — `resolveRecoveredStatus` refactorizado con reducer pattern y accumulator.
- [x] **CC-004** — `src/features/subagent-status/runtime/refresh/stale.ts:96` — Parámetros agrupados en `SettleStaleProbeContext`, 7→4 params.
- [x] **CC-005** — `src/features/subagent-status/runtime/refresh/hydrate.ts:264` — Parámetros agrupados en `HydrationContext`, 7→6 params.

#### Security

- [x] **SC-001** — `src/features/quota/infrastructure/providers/constants.ts:9` — Añadido ponytail comment explicando el User-Agent.

#### Error Handling

- [x] **EH-001** — `src/features/subagent-status/infrastructure/persistence.ts:258` — Resuelto junto con OB-003 (CRITICAL).
- [x] **EH-002** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:242` — Resuelto junto con OB-004 (CRITICAL).
- [x] **EH-003** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:263` — Resuelto junto con OB-004 (CRITICAL).

#### Architecture

- [x] **AR-001** — `src/features/subagent-status/infrastructure/sqlite/script.ts:26` — Python extraído a `recovery.py`, script.ts reducido de 401→97 líneas.

#### Comments

- [x] **CM-001** — `src/kit/use-slot-visibility.ts:23` — Añadido ponytail comment explicando el cast.

#### Observability

- [x] **OB-005** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:83` — Añadido `console.warn` con contexto.
- [x] **OB-006** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:144` — Añadido `console.warn` con contexto.
- [x] **OB-007** — `src/features/subagent-status/runtime/refresh/hydrate-client.ts:45` — Añadido `console.warn` con contexto.
- [x] **OB-008** — `src/features/subagent-status/runtime/refresh/hydrate-client.ts:69,90` — Añadido `console.warn` con contexto.

### 🟡 MEDIUM

#### YAGNI

- [ ] **YG-001** — `prettier.config.mjs:53` — Comentado de plugins Prettier no instalados.

#### Clean Code

- [ ] **CC-006** — `src/features/subagent-status/infrastructure/sqlite/script.ts:1` — 403 líneas el archivo (incluyendo ~310 líneas de Python inline).
- [ ] **CC-007** — `src/features/quota/infrastructure/providers/ollama-cloud.ts:103` — Magic number `5 * 3600` repetido en 3 archivos sin constante nombrada.
- [ ] **CC-008** — `src/features/quota/domain/lines.ts:64` — `windowLine` con 6 parámetros.

#### Simplification

- [ ] **SM-001** — `src/features/subagent-status/domain/tokens.ts:29` — `JSON.stringify` para comparación estructural en hot path.

#### Error Handling

- [ ] **EH-004** — `src/features/subagent-status/runtime/events/bridge.ts:46` — Error silencioso en cleanup de eventos.
- [ ] **EH-005** — `src/features/quota/infrastructure/cache.ts:87` — Error logueado sin stack trace.
- [ ] **EH-006** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:141` — State clone failure no logueado.

#### Performance

- [ ] **PF-001** — `src/features/subagent-status/infrastructure/recovery.ts:100` — Recovery sources procesados secuencialmente (podría ser `Promise.all`).
- [ ] **PF-002** — `src/features/subagent-status/domain/state/mutations.ts:202` — `JSON.stringify` para deep equality en hot path de refresh.

#### Architecture

- [ ] **AR-002** — `src/features/quota/ui/hooks.ts:11` — Duplicación de `useClockTicker` (kit + quota).
- [ ] **AR-003** — `src/features/subagent-status/domain/state/mutations.ts:65` — Mutaciones in-place sin protección type-level.

#### Testing

- [ ] **TS-002** — `test/features/subagent-status/recovery.test.ts:21` — Tests usan Python real como dependencia externa no abstraída.
- [ ] **TS-003** — `test/runtime.test.ts:12` — MockApi con 11 propiedades, muchas no ejercitadas.

#### Dependencies

- [ ] **DP-001** — `src/kit/use-clock-ticker.ts:1` — Deep import de `solid-js/dist/solid.js` en vez de `solid-js`.

#### Observability

- [ ] **OB-009** — `src/features/subagent-status/infrastructure/logs.ts:37` — `safeRead` traga todos los errores silenciosamente.
- [ ] **OB-010** — `src/features/subagent-status/infrastructure/sqlite/script.ts:220` — Python SQLite parser ignora JSON corrupto.
- [ ] **OB-011** — `src/features/subagent-status/infrastructure/sqlite/hydrate.ts:243` — JSON parse failure produce `undefined` sin log.
- [ ] **OB-012** — `src/features/subagent-status/runtime/refresh/hydrate.ts:193` — TUI message activity fetch failure silencioso.
- [ ] **OB-013** — `src/features/subagent-status/infrastructure/persistence.ts:231` — State load failure silencioso → empty state.

#### Data Integrity

- [ ] **DI-001** — `src/features/subagent-status/runtime/queue.ts:78` — Buffer truncation sin warning.
- [ ] **DI-002** — `src/features/quota/infrastructure/providers/config.ts:62` — Config parse failure → `null` sin diagnóstico.

#### Concurrency

- [ ] **CR-001** — `src/features/subagent-status/infrastructure/logs.ts:21` — Module-level mutable `Map` compartido sin sincronización.
- [ ] **CR-002** — `src/features/subagent-status/runtime/queue.ts:26` — Estado mutable compartido en `CoalescedTaskRunner` con re-entrancy.

### 🟢 LOW

#### Security

- [ ] **SC-002** — `src/features/quota/infrastructure/providers/auth.ts:68` — JWT payload decodificado sin verificar firma (token local, pero sienta precedente).

#### Error Handling

- [ ] **EH-007** — `src/features/subagent-status/infrastructure/persistence.ts:66` — Cleanup de archivo temp silencioso (aceptable pero documentar).

#### Performance

- [ ] **PF-003** — `src/features/subagent-status/domain/tokens.ts:30` — `JSON.stringify` para token equality (4 campos, overhead bajo).
- [ ] **PF-004** — `src/features/subagent-status/runtime/refresh/orchestrator.ts:254` — Clone innecesario cuando no hay hijos 'done'.
- [ ] **PF-005** — `src/features/subagent-status/ui/view-model.ts:82` — Rebuild redundante de snapshot en cada persistencia.

#### Architecture

- [ ] **AR-004** — `prettier.config.mjs:53` — Comentado de plugins sin plan.
- [ ] **AR-005** — `src/features/quota/infrastructure/providers/openai.ts:172` — Re-exports de funciones domain desde infrastructure.

#### Testing

- [ ] **TS-004** — `test/features/subagent-status/state.test.ts:44` — Faltan tests para edge cases (empty strings, NaN timestamps, etc.).
- [ ] **TS-005** — `test/features/subagent-status/integration/sqlite-recovery.integration.test.ts:1` — Test de integración no aislado.

#### Dependencies

- [ ] **DP-002** — `package.json:18` — `@types/node: ^25.9.1` muy restrictivo.
- [ ] **DP-003** — `src/kit/solid-reactive.d.ts:1` — Type shim para deep import innecesario (paper de DP-001).

#### Comments

- [ ] **CM-002** — `prettier.config.mjs:26` — Comentarios verbosos en opciones que matchean defaults de Prettier.

#### Readability

- [ ] **RD-001** — `src/features/subagent-status/ui/format.ts:149` — `formatSidebarCompactCount` y `formatCount` tienen propósito solapado con nombres poco descriptivos.

#### Observability

- [ ] **OB-014** — `src/features/quota/runtime.tsx:81` — Logs sin identificadores de correlación.
- [ ] **OB-015** — `src/features/subagent-status/runtime/queue.ts:46` — Coalesced task runner traga errores silenciosamente.
- [ ] **OB-016** — `src/features/subagent-status/runtime/refresh/stale.ts:132` — Decisiones críticas del stale-probe ocultas detrás de debug flag.
- [ ] **OB-017** — `src/features/subagent-status/infrastructure/persistence.ts:66` — Cleanup de temp file silencioso.

#### Data Integrity

- [ ] **DI-003** — `src/features/subagent-status/runtime/queue.ts:108` — Buffer truncation sin warning.

#### Concurrency

- [ ] **CR-003** — `src/features/subagent-status/infrastructure/logs.ts:85` — (Para awareness, realmente es seguro como variable local.)

#### Config Hygiene

- [ ] **CH-001** — `src/features/subagent-status/shared/display.ts:2` — Mutable boolean global compartido entre instancias.
- [ ] **CH-002** — `src/features/subagent-status/runtime/i18n.ts:30` — Locale cache nunca invalidado.
- [ ] **CH-003** — `index.tsx:14` — Type assertion `{} as TuiPluginMeta` esconde cambios de tipo.
- [ ] **CH-004** — `src/features/quota/runtime.tsx:12` — `ALLOWED_PROVIDER_IDS` duplicado (también en `domain/options.ts`).

---

## Progress

- **CRITICAL**: `6 / 6` ✅
- **HIGH**: `17 / 17` ✅
- **MEDIUM**: `0 / 24`
- **LOW**: `0 / 23`
- **Total**: `23 / 70`

---

## Recommendations

1. **🔴 Eliminar catch blocks vacíos en producción** — 4 bloques CRITICAL en `auth.ts`, `config.ts`, `persistence.ts`, `orchestrator.ts` silencian errores sin log. Son los paths principales: login, config, persistencia de estado, y refresh. Agregar `console.warn()` con contexto antes del `catch { }` es el fix mínimo.

2. **🔴 Extraer script Python de TypeScript** — `script.ts` tiene 310 líneas de Python en un template literal. Separar a `.py` aparte o, mejor, implementar en TypeScript con `node:sqlite` (Node 22+) para eliminar la dependencia de `python3`.

3. **🟠 Añadir `forbidOnly: true` en vitest.config.ts** — Sin esto, un `it.only` committed pasa CI como si todo estuviera bien.

4. **🟠 Fragmentar funciones largas** — `upsertRunningChild` (120 líneas), `loadState` (130 líneas), `resolveRecoveredStatus` (136 líneas) exceden el límite recomendado. Extraer helpers con nombres intencionales.

5. **🟡 Reemplazar deep imports de solid-js** — `use-clock-ticker.ts` y `use-slot-visibility.ts` importan de `solid-js/dist/solid.js` en vez de `solid-js`. Eliminar el type shim `solid-reactive.d.ts` como consecuencia.

6. **🟡 Reemplazar `JSON.stringify` para comparaciones** — En `tokens.ts:29` (equality) y `mutations.ts:202` (deep compare), usar comparación campo-a-campo para evitar bugs por orden de keys y overhead de alocación.
