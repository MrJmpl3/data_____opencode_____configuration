# agent-monitor — Agent Instructions

## Identity

Plugin TUI para OpenCode que agrega monitoreo en vivo al sidebar con dos features independientes:
**subagent-status** (sesiones de subagentes) y **quota** (consumo de APIs).

## Stack

- TypeScript 5.9 (`strict`, `verbatimModuleSyntax`)
- SolidJS 1.9 vía `@opentui/solid` (JSX con `react-jsx` transform)
- `@opencode-ai/plugin` 1.17.13 para la API TUI
- Vitest 4.x para tests
- Prettier 3.x para formato
- ESModules (`"type": "module"`)

## Entry point

`index.tsx` exporta un `TuiPluginModule` con `id: 'agent-monitor'`. Registra ambos features en
orden: subagent-status (order 110), quota (order 120). OpenCode mergea los slots por order
ascendente.

## Configuración

### agent-monitor.json (ambas features)

Ambos features se configuran desde `~/.config/opencode/agent-monitor.json` (o
`$OPENCODE_CONFIG_DIR/agent-monitor.json`).

Estructura: `{ sections: { quota: { providers?, options? }, subagent-status: { options? } } }`

#### Sección `quota`

Providers con `authCookie`: `opencode-go` (requiere `authCookie` y `workspaces[]` con
`workspaceId` + `label`), `ollama-cloud` (solo `authCookie`).

Options: `displayMode` ('remaining'|'used'), `visibleProviders` (array de `QuotaProviderId`),
`pollIntervalMs`, `minRefreshIntervalMs`, `providerCacheTtlMs`, `providerErrorBackoffMs`,
`experimentalOpenAIResetCredits`.

Todos los valores numéricos pasan por `clampNumberOption` con mínimo seguro de 60s
(`MIN_SAFE_REFRESH_INTERVAL_MS`).

#### Sección `subagent-status`

Lee `sections.subagent-status.options` de `agent-monitor.json` mediante
`readSubagentStatusOptions()` en `infrastructure/config.ts`. El parámetro `options` de
`registerSubagentStatusTui` (segundo elemento de `tui.json`) funciona como fallback si la sección no
existe en el archivo.

Estructura tipada como `SubagentStatusPluginOptions`:

- `debug: boolean` — habilita console.log
- `staleRunningProbePolicy`: `baseBackoffMs` (default 60s), `hardStaleAfterMs` (default 5h),
  `maxBackoffMs` (default 5min), `maxAttempts` (default 4), `refreshIntervalMs` (default 60s)
- `visibility`: `doneRetentionMs` (default 10min), `staleRetentionMs` (default 20min)
- `persistence`: `statePath` (string), `preserveStateOnStartup` (boolean, default false)
- `recovery`: `sqliteDatabasePath` (string)

Las opciones se normalizan en `normalizeSubagentStatusPluginOptions`, que clampa valores y aplica
defaults. Si la sección no existe en `agent-monitor.json`, se usan defaults completos.

### Auth.json

La mayoría de providers resuelven auth desde `~/.local/share/opencode/auth.json` (o
`$OPENCODE_CONFIG_DIR/auth.json`).

Formatos soportados:

- `{ "type": "oauth", "access": "..." }` — para github-copilot, openai
- `{ "type": "api", "key": "..." }` — para openrouter, deepseek
- `{ "type": "oauth", "account_id": "..." }` o `chatgpt_account_id` en JWT — para accountId de
  OpenAI

La lectura se hace en `infrastructure/providers/auth.ts`.

## Features

### Quota

Propósito: mostrar consumo de APIs de AI en el sidebar.

Cada provider vive en `infrastructure/providers/` e implementa su propia lógica de fetch con timeout
de 10s (`FETCH_TIMEOUT_MS`). Los providers son:

| Provider       | URL                                | Auth source         |
| -------------- | ---------------------------------- | ------------------- |
| opencode-go    | `opencode.ai/workspace/{id}/go`    | agent-monitor.json  |
| github-copilot | `api.github.com/...`               | auth.json (oauth)   |
| openrouter     | `openrouter.ai/api/v1/credits`     | auth.json (api key) |
| openai         | `chatgpt.com/backend-api/wham/...` | auth.json (oauth)   |
| deepseek       | `api.deepseek.com/user/balance`    | auth.json (api key) |
| ollama-cloud   | `ollama.com/settings`              | agent-monitor.json  |

El feature usa un cache interno (`cache.ts`) con TTL configurable y backoff en errores. Los valores
numéricos de configuración se clampdean a `MIN_SAFE_REFRESH_INTERVAL_MS` (60s).

El slot se registra con order 120. El componente `QuotaSection` itera los providers visibles y
muestra su consumo en formato de líneas.

### Subagent-status

Propósito: monitorear subagentes de OpenCode en tiempo real.

Arquitectura:

1. **Event bridge** (`events/bridge.ts`): se conecta al event bus de OpenCode y recibe eventos de
   subagentes.
2. **Session scope** (`session/scope.ts`): cada sesión de subagente tiene scope propio. Al navegar
   entre sesiones se resetea el estado.
3. **Refresh orchestrator** (`refresh/orchestrator.ts`): maneja probes a sesiones running, hydrate
   desde SQLite y reconcilia el estado.
4. **Persistence** (`infrastructure/persistence.ts`): snapshots en disco como JSON. Recovery
   opcional desde SQLite.
5. **Collapse logic** (`ui/collapse.ts`): colapsa work items sintéticos (tool calls, subtasks)
   contra sesiones reales para evitar duplicados en la UI.

Reglas de dominio importantes:

- Sesiones `running` sin evidencia tras `hardStaleAfterMs` se marcan como `error` automáticamente
  (`markHardStaleRunningChildren` en `tui-runtime.ts`).
- Items `done` desaparecen de la UI tras `doneRetentionMs` (default 10 min). Items `error` y `stale`
  permanecen visibles siempre.
- Eventos durante startup se bufferan (hasta 512) y se replayan cuando el runtime está listo.
- El reloj de 1Hz (`useClockTicker`) solo corre cuando el slot es visible Y hay contenido visible.
- El slot se registra con order 110 (arriba del quota).

## Convenios de código

- `verbatimModuleSyntax` — imports tipo deben usar `import type`.
- `allowImportingTsExtensions` — imports incluyen extensión `.ts`/`.tsx`.
- No hay `tslib` ni helpers de runtime; el target ES2022 cubre los features modernos.
- Los comentarios tienen tono educativo y profesional. Predominantemente en inglés técnico, con
  algunos comentarios estratégicos en español neutral donde explica decisiones de dominio.
- Prettier: single quotes, trailing commas, printWidth 120, semicolons siempre.
- Tests en Vitest con `environment: 'node'`.

## Tests

- `vitest run` ejecuta la suite.
- Tests en `test/` y en directorios cercanos a los módulos que testean.
- Sin framework de mocking externo — se usan mocks manuales y fábricas de estado.

## Comandos de desarrollo

```bash
npm run typecheck       # Validación de tipos (tsc --noEmit)
npm test                # Tests unitarios
npm run format          # Formateo con Prettier
npm run format:check    # Verificación de formato
```

## Archivos clave

| Archivo                                                      | Propósito                                              |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `index.tsx`                                                  | Entry point, registro de ambas features                |
| `src/features/quota/runtime.tsx`                             | Registro del slot quota + refresh triggers             |
| `src/features/quota/domain/options.ts`                       | Opciones de quota con resolución y clamping            |
| `src/features/quota/infrastructure/providers/`               | Providers de APIs (cada uno en su archivo)             |
| `src/features/quota/infrastructure/providers/config.ts`      | Lector de `agent-monitor.json`                         |
| `src/features/quota/infrastructure/providers/auth.ts`        | Lector de `auth.json`                                  |
| `src/features/subagent-status/runtime/tui-runtime.ts`        | Orquestador del runtime de subagent-status             |
| `src/features/subagent-status/runtime/options.ts`            | Opciones con normalización                             |
| `src/features/subagent-status/shared/display.ts`             | Política de visibilidad                                |
| `src/features/subagent-status/ui/collapse.ts`                | Colapso de work items sintéticos                       |
| `src/features/subagent-status/infrastructure/persistence.ts` | Persistencia de snapshots en disco                     |
| `src/features/subagent-status/infrastructure/config.ts`      | Lector de `agent-monitor.json` sección subagent-status |
| `src/features/subagent-status/domain/types.ts`               | Tipos del dominio de subagentes                        |
