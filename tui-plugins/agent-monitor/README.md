# agent-monitor

Plugin TUI para OpenCode que agrega monitoreo en vivo al sidebar: estado de subagentes y uso de
APIs. Dos features independientes bajo un mismo plugin.

## Features

| Feature           | Order | Descripción                                          |
| ----------------- | ----- | ---------------------------------------------------- |
| `subagent-status` | 110   | Sesiones de subagentes: running, done, error, stale  |
| `quota`           | 120   | Consumo de APIs (OpenCode Go, Copilot, OpenAI, etc.) |

Ambas son independientes. Cada una registra su propio slot en el sidebar y OpenCode las mergea por
`order` ascendente.

---

## Instalación

```bash
cd ~/.config/opencode
npm install ./tui-plugins/agent-monitor
```

Registrar en `tui.json` dentro de `"plugins"`:

```json
{
  "plugins": ["./node_modules/agent-monitor"]
}
```

Toda la configuración se hace desde `agent-monitor.json` (ver sección
[Configuración](#configuración)). No se necesita segundo elemento del array en `tui.json`.

---

## Configuración

Ambos features se configuran desde `~/.config/opencode/agent-monitor.json` (o
`$OPENCODE_CONFIG_DIR/agent-monitor.json` si la variable está definida).

```jsonc
{
  "sections": {
    // ── Feature: quota (consumo de APIs) ──────────────────
    "quota": {
      "providers": {
        // opencode-go necesita authCookie + al menos un workspace
        "opencode-go": {
          "authCookie": "cookie_de_opencode.ai",
          "workspaces": [{ "workspaceId": "ws_abc123", "label": "Producción" }],
        },
        // ollama-cloud solo necesita authCookie
        "ollama-cloud": {
          "authCookie": "cookie_de_ollama.com",
        },
      },
      "options": {
        "displayMode": "remaining", // "remaining" | "used"
        "visibleProviders": [
          // default: ["opencode-go", "github-copilot", "openrouter"]
          "opencode-go",
          "github-copilot",
          "openrouter",
          "openai",
          "deepseek",
          "ollama-cloud",
        ],
        "pollIntervalMs": 600000, // default: 10 min, mínimo seguro: 60s
        "minRefreshIntervalMs": 120000, // default: 2 min, mínimo seguro: 60s
        "providerCacheTtlMs": 300000, // default: 5 min, mínimo seguro: 60s
        "providerErrorBackoffMs": 900000, // default: 15 min, mínimo seguro: 60s
        "experimentalOpenAIResetCredits": false, // OFF por defecto
      },
    },

    // ── Feature: subagent-status (monitoreo de sesiones) ──
    "subagent-status": {
      "options": {
        "debug": false, // logs de debug en consola

        // Política de probing para sesiones que siguen apareciendo como running
        "staleRunningProbePolicy": {
          "baseBackoffMs": 60000, // default: 60s, mínimo: 1s
          "hardStaleAfterMs": 18000000, // default: 5h
          "inactiveThresholdMs": 600000, // default: 10 min — marca error si no hay evidencia de running ni nueva actividad
          "maxBackoffMs": 300000, // default: 5 min
          "maxAttempts": 4, // default: 4, máximo: 100
          "refreshIntervalMs": 60000, // default: 60s, mínimo: 1s
        },

        // Control de visibilidad de ítems completados/stale
        "visibility": {
          "doneRetentionMs": 600000, // default: 10 min
          "staleRetentionMs": 1200000, // default: 20 min
        },

        // Persistencia de estado
        "persistence": {
          "statePath": "/tmp/subagent-status.json",
          "preserveStateOnStartup": true, // default: false
        },

        // Recovery desde SQLite de OpenCode
        "recovery": {
          "sqliteDatabasePath": "/tmp/opencode.db",
        },
      },
    },
  },
}
```

Si alguna sección no está presente, esa feature usa sus valores por defecto.

---

## Providers de quota

### Auth resolution

Cada provider resuelve autenticación desde `~/.local/share/opencode/auth.json` (o
`$OPENCODE_CONFIG_DIR/auth.json`). El plugin **no** lee variables de entorno para auth.

| Provider         | Auth                       | Lo que muestra                      |
| ---------------- | -------------------------- | ----------------------------------- |
| `opencode-go`    | `authCookie` (config file) | Ventanas 5h / weekly / monthly      |
| `github-copilot` | OAuth token (auth.json)    | Interacciones premium mensuales     |
| `openrouter`     | API key (auth.json)        | Créditos restantes                  |
| `openai`         | OAuth token (auth.json)    | Límites hourly, weekly, code-review |
| `deepseek`       | API key (auth.json)        | Balance por moneda                  |
| `ollama-cloud`   | `authCookie` (config file) | Uso session + weekly                |

### Formato de auth.json

```jsonc
{
  // OAuth token
  "github-copilot": {
    "type": "oauth",
    "access": "ghu_token...",
  },
  "openai": {
    "type": "oauth",
    "access": "sess_token...",
  },
  // API key
  "openrouter": {
    "type": "api",
    "key": "sk-or-v1-...",
  },
  "deepseek": {
    "type": "api",
    "key": "sk-...",
  },
}
```

Providers que necesitan `authCookie` (`opencode-go`, `ollama-cloud`) la leen desde
`agent-monitor.json`, **no** desde `auth.json`.

---

## Stack

TypeScript + Solid (`@opentui/solid`) + Vitest + Prettier.

## Requisitos

- OpenCode con soporte TUI
- Node 18+ / npm

```bash
npm install
```

## Desarrollo

```bash
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run format          # prettier --write
npm run format:check    # prettier --check
```

## Estructura

```
src/
├── index.tsx                   # Entry point: registra ambas features
├── kit/                        # Utilidades compartidas
│   ├── coercion.ts             # Type guards: isRecord, asString, toFiniteNumber...
│   ├── clone.ts                # cloneState (shallow clone optimizado)
│   ├── format.ts               # fmtDuration (segundos → "1h2m3s")
│   ├── use-clock-ticker.ts     # Hook Solid: timer de 1Hz
│   ├── use-polling.ts          # Hook Solid: polling periódico
│   └── use-slot-visibility.ts  # Hook Solid: visibilidad de slot
│
├── features/
│   ├── quota/                  # Monitor de cuotas de API
│   │   ├── domain/             # Tipos + formateo + parseo + opciones
│   │   ├── infrastructure/     # Providers (cada API) + cache + config
│   │   ├── ui/                 # Componentes Solid
│   │   └── runtime.tsx         # Registro del slot + suscripción a eventos
│   │
│   └── subagent-status/        # Monitor de subagentes
│       ├── domain/             # Estado + lógica de negocio
│       │   ├── state/          # Mutaciones, helpers, pruning
│       │   └── reconcile/      # Normalización + reconciliación
│       ├── infrastructure/     # Persistencia + recovery (SQLite)
│       ├── runtime/            # Eventos, refresh, sesiones
│       │   ├── events/         # Bridge + parse + handle
│       │   ├── refresh/        # Stale probe + hydrate + orchestrator
│       │   └── session/        # Navegación + scope + focus
│       ├── shared/             # Display helpers, visibility policy
│       └── ui/                 # Componentes Solid
│
└── test/                       # Suites vitest
```

## Detalles de implementación

### Subagent-status

- Conecta al event bus de OpenCode mediante un bridge (`events/bridge.ts`) para recibir eventos de
  subagentes en tiempo real.
- Cada sesión de subagente tiene su propio scope; al navegar entre sesiones se resetea el estado
  interno.
- El runtime reconcilia eventos diferidos durante startup y cachea los más recientes (hasta 512).
- Persiste snapshots en disco como JSON (`persistence.ts`) y puede recovery desde SQLite
  (`sqlite/hydrate.ts`).
- Política de visibilidad: items `done` desaparecen tras `doneRetentionMs` (default 10 min); items
  `stale`/`error` permanecen visibles siempre.
- Sesiones `running` sin evidencia de mensajes ni nueva actividad tras `inactiveThresholdMs`
  (default 10 min) se marcan como `error`.
- Sesiones `running` que superan `hardStaleAfterMs` (default 5h) sin evidencia se marcan como
  `error` automáticamente (safety-net).
- La UI colapsa work items sintéticos (tool calls, subtasks) contra sesiones reales para evitar
  duplicados.

### Quota

- Cada provider implementa su propia lógica de fetch (`infrastructure/providers/`).
- Cache interno con TTL configurable (default 5 min) + backoff ante errores (default 15 min).
- Los valores numéricos de configuración se clampdean a un mínimo seguro de 60s para evitar loops
  accidentales.
- Soporta modo `remaining` (créditos restantes) y `used` (consumo).
