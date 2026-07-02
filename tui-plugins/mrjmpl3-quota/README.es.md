# mrjmpl3-quota

<!-- README-I18N:START -->

[English](./README.md) | **Español**

<!-- README-I18N:END -->

Plugin TUI para OpenCode que muestra la cuota de los proveedores, el ritmo de uso y las ventanas de
reinicio en la barra lateral.

**Solo local.** Sin fallbacks, sin compatibilidad hacia atrás.

## Qué muestra

Para cada proveedor, el plugin muestra:

- **Ventanas de uso** — cuota restante o usada con tiempo hasta el reinicio (ej. `Wk 87% · 4d12h`)
- **Ritmo de uso** — una línea secundaria debajo de cada ventana con ritmo que indica si el consumo
  actual está dentro del ritmo responsable o lo excede (ej. `✓ 2.15% under` o `⚠ 7.14% over`)
- **Proyección de recuperación** — cuando el uso supera el ritmo responsable, la línea de ritmo
  agrega cuánto tiempo necesitaría la IA estar inactiva para volver al ritmo responsable (ej.
  `⚠ 7.14% over · ~12h`). Solo se muestra cuando la longitud de la ventana es conocida y la
  recuperación es matemáticamente posible.
- **Detección de límite de tasa** — retrocede automáticamente cuando un proveedor devuelve 429, con
  tiempo de espera configurable
- **Créditos de reinicio (OpenAI)** — cantidad de créditos acumulados/restantes con próxima fecha de
  vencimiento (ej. `Reset · 1 available · Jul 17`). Distingue entre `available`, `none` y
  `unavailable`.

## Proveedores soportados

| Proveedor        | Datos mostrados                                                                                   | Auth                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `opencode-go`    | Ventanas de 5h, Semanal, Mensual + Ritmo mensual                                                  | `quota.json` → `providers.opencode-go.authCookie` |
| `github-copilot` | Ventana mensual + Ritmo mensual                                                                   | `auth.json` → `github-copilot` (oauth)            |
| `openrouter`     | Saldo de créditos                                                                                 | `auth.json` → `openrouter` (api)                  |
| `openai`         | Ventanas de 5h, Semanal, Code + Ritmo semanal + límites adicionales + Créditos de reinicio (exp.) | `auth.json` → `openai` (oauth)                    |
| `deepseek`       | Saldo de créditos                                                                                 | `auth.json` → `deepseek` (api)                    |

## Auth

Todos los tokens provienen exclusivamente de `~/.local/share/opencode/auth.json` — el archivo de
auth estándar de OpenCode. Sin variables de entorno, sin archivos separados, sin fallbacks.

Ejemplo:

```json
{
  "github-copilot": { "type": "oauth", "access": "ghu_..." },
  "openai": { "type": "oauth", "access": "sess-..." },
  "deepseek": { "type": "api", "key": "sk-..." },
  "openrouter": { "type": "api", "key": "sk-or-v1-..." }
}
```

Entradas por proveedor:

| Proveedor      | Clave en auth.json | Tipo    | Campo que lee |
| -------------- | ------------------ | ------- | ------------- |
| github-copilot | `github-copilot`   | `oauth` | `access`      |
| openai         | `openai`           | `oauth` | `access`      |
| deepseek       | `deepseek`         | `api`   | `key`         |
| openrouter     | `openrouter`       | `api`   | `key`         |

## Configuración

Toda la configuración vive en `~/.config/opencode/quota.json`. El plugin **ignora** cualquier cosa
que pases en `tui.json` — este archivo es la única fuente de verdad.

```json
{
  "providers": {
    "opencode-go": {
      "authCookie": "Fe26.2**...",
      "workspaces": [
        { "workspaceId": "wrk_123", "label": "Personal" },
        { "workspaceId": "wrk_456", "label": "Team" }
      ]
    }
  },
  "options": {
    "displayMode": "remaining",
    "visibleProviders": ["opencode-go", "github-copilot", "openrouter"],
    "pollIntervalMs": 600000,
    "minRefreshIntervalMs": 120000,
    "providerCacheTtlMs": 300000,
    "providerErrorBackoffMs": 900000,
    "experimentalOpenAIResetCredits": false
  }
}
```

### `providers.opencode-go`

La cookie de autenticación y las definiciones de workspaces van bajo `providers.opencode-go`:

```json
{
  "providers": {
    "opencode-go": {
      "authCookie": "Fe26.2**...",
      "workspaces": [{ "workspaceId": "wrk_123", "label": "Personal" }]
    }
  }
}
```

El ID del workspace está en tu dashboard URL: `https://opencode.ai/workspace/<ID>/go`

**Cache** — las opciones globales `providerCacheTtlMs` y `providerErrorBackoffMs` controlan cuánto
tiempo se cachean las respuestas de OpenCode Go antes de volver a consultar. Véanse las secciones
correspondientes abajo.

### `displayMode`

Controla si el plugin muestra la cuota restante o la usada.

| Valor         | Comportamiento                 |
| ------------- | ------------------------------ |
| `"remaining"` | Muestra lo que queda (default) |
| `"used"`      | Muestra lo que se ha consumido |

```json
{ "displayMode": "used" }
```

### `visibleProviders`

Qué proveedores mostrar y en qué orden. Los IDs inválidos o desconocidos se ignoran.

**Valores permitidos:** `"opencode-go"`, `"github-copilot"`, `"openrouter"`, `"openai"`,
`"deepseek"`

**Default:** `["opencode-go", "github-copilot", "openrouter"]`

```json
{ "visibleProviders": ["openai", "opencode-go", "openrouter"] }
```

### `pollIntervalMs`

Cada cuánto refrescar los datos de cuota en segundo plano, en milisegundos.

**Default:** `600000` (10 minutos).  
**Mínimo:** `60000` (1 minuto).  
**Poner a `0`** para desactivar el polling periódico (los refrescos igual ocurren en eventos de
sesión).

```json
{ "pollIntervalMs": 300000 }
```

### `minRefreshIntervalMs`

Tiempo mínimo entre dos solicitudes de refresco consecutivas, en milisegundos. Evita ráfagas de
refresco por eventos de sesión.

**Default:** `120000` (2 minutos).  
**Mínimo:** `60000` (1 minuto).

```json
{ "minRefreshIntervalMs": 60000 }
```

### `providerCacheTtlMs`

Cuánto tiempo se considera fresca una respuesta exitosa de un proveedor antes de volver a
consultarla, en milisegundos.

**Default:** `300000` (5 minutos).  
**Mínimo:** `60000` (1 minuto).

```json
{ "providerCacheTtlMs": 600000 }
```

### `providerErrorBackoffMs`

Duración base de espera cuando un proveedor devuelve un **error de límite de tasa** (HTTP 429, o
mensajes que contengan palabras clave como `rate limit`, `too many requests`, `temporarily` o
`secondary rate`). En errores consecutivos de límite de tasa, la espera se multiplica (×1, ×2, ×3,
×4) hasta un tope de 1 hora. Los errores que no son de límite de tasa (incluyendo 403 genéricos de
autenticación/prohibido) usan `providerCacheTtlMs` como base. Cuando el mensaje de error incluye un
header `retry-after` o `rate-limit-reset`, el plugin respeta esa duración si es mayor que la espera
calculada.

**Default:** `900000` (15 minutos).  
**Mínimo:** `60000` (1 minuto).

```json
{ "providerErrorBackoffMs": 300000 }
```

### `experimentalOpenAIResetCredits`

**EXPERIMENTAL — OFF por default.** Activa la obtención de créditos de reinicio de OpenAI desde un
endpoint privado no documentado de ChatGPT. Este endpoint no tiene soporte, puede romperse sin aviso
y usa headers de suplantación de cliente. Poner a `true` solo si aceptás esos riesgos.

| Valor   | Comportamiento                                                   |
| ------- | ---------------------------------------------------------------- |
| `false` | No se obtienen créditos de reinicio (default)                    |
| `true`  | Se obtienen créditos de reinicio desde la API privada de ChatGPT |

```json
{ "experimentalOpenAIResetCredits": true }
```

## Créditos de reinicio (OpenAI) — EXPERIMENTAL, desactivado por default

> **Advertencia:** Esta funcionalidad usa un **endpoint privado no documentado de ChatGPT** con
> headers de suplantación de cliente. No tiene soporte, puede romperse sin aviso y podría violar los
> términos de servicio de OpenAI. **Usalo bajo tu propio riesgo.**

La obtención de créditos de reinicio está **OFF por default**. Para activarla, poné
`experimentalOpenAIResetCredits: true` en `quota.json`:

```json
{
  "visibleProviders": ["openai"],
  "experimentalOpenAIResetCredits": true
}
```

Cuando está activado, el plugin obtiene créditos acumulados/restantes desde un endpoint privado de
ChatGPT junto con los datos de uso. Esto es una consulta defensiva opcional — si falla, las líneas
de uso/ritmo/créditos existentes no se ven afectadas.

El plugin muestra tres estados explícitos:

- **Available** — `  Reset · 1 available · Jul 17`
- **None available** — `  Reset · none` (respuesta 200 con cero créditos)
- **Unavailable** — `  Reset · unavailable` (error de consulta/parseo o problema de auth/HTTP)

Cuando hay datos de concesión disponibles, una segunda línea muestra la fecha de concesión en el
mismo formato compacto mes/día:

```
   Reset · 1 available · Jul 17
  Granted Jun 17
```

El plugin no expone tokens de auth, IDs de cuenta, IDs de crédito ni dumps de payload. La fecha/hora
se renderiza usando la zona horaria local vía `Intl.DateTimeFormat`.

## Proyección de recuperación

Cuando el uso supera el ritmo responsable y la longitud de la ventana es conocida, la línea de ritmo
agrega una proyección de recuperación:

```
    ⚠ 7.14% over · ~12h
```

Esto indica cuánto tiempo necesitaría la IA estar inactiva (consumir cero cuota adicional) para que
la tasa de uso responsable alcance el nivel de uso actual. La proyección solo se muestra cuando es
matemáticamente defendible — se omite cuando el uso está en o por debajo del ritmo responsable, o
cuando la longitud de la ventana es desconocida.

## Layout

El plugin usa un diseño estructurado de varias líneas por proveedor:

```
▸ OpenAI
  5h 20% · 5h
  Wk 30% · 4d12h
    ✓ 0.1% under
  Code 40% · 15h
  Credits $5.00
```

- Encabezado del proveedor (`▸ OpenAI`)
- Una línea principal por ventana: `label valor · reinicio`
- Línea de ritmo secundaria opcional (más indentada): estado del ritmo y proyección de recuperación
- Líneas de metadatos (créditos, estado de reinicio) agrupadas después de las ventanas
- Los límites de tasa adicionales de OpenAI se renderizan con texto de estado visible compacto como
  `blocked · Vision` o `limit reached · Audio`; las etiquetas largas se acortan para mantener la
  barra lateral angosta

## Solución de problemas

Si el panel muestra **No data**, verificá cada capa:

### 1. Los archivos existen en las rutas correctas

```bash
ls -la ~/.local/share/opencode/auth.json    # tokens
ls -la ~/.config/opencode/quota.json    # config
```

Ambos deben existir y ser JSON válido.

### 2. Estructura de quota.json

```bash
python3 -m json.tool ~/.config/opencode/quota.json
```

Debe tener `providers` y/o `options` como claves de primer nivel:

```json
{
  "providers": {
    "opencode-go": {
      "authCookie": "Fe26.2**...",
      "workspaces": [...]
    }
  },
  "options": {
    "visibleProviders": ["opencode-go", "github-copilot", "openrouter"],
    "displayMode": "remaining"
  }
}
```

`visibleProviders` en `options` determina qué proveedores aparecen. Si falta, el default es
`["opencode-go", "github-copilot", "openrouter"]`.

### 3. Tokens en auth.json

```bash
python3 -m json.tool ~/.local/share/opencode/auth.json
```

Debe tener entradas para los proveedores que querés ver. Por ejemplo:

```json
{
  "github-copilot": { "type": "oauth", "access": "ghu_..." },
  "openai": { "type": "oauth", "access": "sess-..." },
  "deepseek": { "apiKey": "sk-..." },
  "openrouter": { "apiKey": "sk-or-v1-..." }
}
```

Si un proveedor no tiene un token válido, el plugin lo saltea silenciosamente.

### 4. opencode-go

Si usás `opencode-go`, necesita ambos en `quota.json`:

```json
{
  "providers": {
    "opencode-go": {
      "authCookie": "Fe26.2**...",
      "workspaces": [{ "workspaceId": "wrk_...", "label": "Personal" }]
    }
  }
}
```

El ID del workspace está en tu dashboard URL: `https://opencode.ai/workspace/<ID>/go`

### 5. Plugin cargado

Si la barra lateral sigue sin mostrar nada, confirmá que el plugin está registrado en
`~/.config/opencode/opencode.json` bajo `tui.plugins`:

```json
{
  "tui": {
    "plugins": ["/home/tu-usuario/.config/opencode/tui-plugins/mrjmpl3-quota"]
  }
}
```

No se pasan opciones aquí — `quota.json` es la única fuente de verdad.

## Desarrollo

```bash
npm install
npm run format
npm run format:check
npm test
npm run typecheck
```
