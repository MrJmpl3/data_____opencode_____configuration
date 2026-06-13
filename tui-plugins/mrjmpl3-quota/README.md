# mrjmpl3-quota

TUI plugin for OpenCode that displays provider quota, usage pace, and reset windows in the sidebar.

## What it shows

For each provider, the plugin displays:

- **Usage windows** — remaining or used quota with time until reset (e.g. `Weekly · 87% · 4d 12h left`)
- **Usage pace** — whether current consumption is on track or exceeding the responsible rate (e.g. `Usage pace · ✓ ok · 2.15% below`)
- **Rate-limit awareness** — backs off automatically when a provider returns 429, with configurable cooldown

## Supported providers

| Provider         | Data shown                                                   | Auth                                                              |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `opencode-go`    | Rolling 5h, Weekly, Monthly windows + Monthly pace           | `OPENCODE_GO_WORKSPACE_ID` + `OPENCODE_GO_AUTH_COOKIE`            |
| `github-copilot` | Monthly window + Monthly pace                                | `auth.json` (oauth entry `github-copilot`)                        |
| `openrouter`     | Credit balance                                               | `OPENROUTER_API_KEY` or `~/.config/opencode/openrouter-auth.json` |
| `openai`         | 5h, Weekly, Code Review windows + Weekly pace + Spark limits | `auth.json` (oauth entry `openai`)                                |

## Options

Configure the plugin by passing an options object:

```json
{
  "plugin": [
    [
      "/absolute/path/to/tui-plugins/mrjmpl3-quota",
      {
        "displayMode": "remaining",
        "visibleProviders": ["opencode-go", "github-copilot", "openrouter"],
        "pollIntervalMs": 600000,
        "minRefreshIntervalMs": 120000,
        "providerCacheTtlMs": 300000,
        "providerErrorBackoffMs": 900000
      }
    ]
  ]
}
```

### `displayMode`

Controls whether the plugin shows remaining or used quota.

| Value         | Behavior                     |
| ------------- | ---------------------------- |
| `"remaining"` | Shows what is left (default) |
| `"used"`      | Shows what has been consumed |

```json
{ "displayMode": "used" }
```

### `visibleProviders`

Which providers to display and in what order. Invalid or unknown IDs are ignored.

**Allowed values:** `"opencode-go"`, `"github-copilot"`, `"openrouter"`, `"openai"`

**Default:** `["opencode-go", "github-copilot", "openrouter"]`

```json
{ "visibleProviders": ["openai", "opencode-go", "openrouter"] }
```

### `pollIntervalMs`

How often to refresh quota data in the background, in milliseconds.

**Default:** `600000` (10 minutes).  
**Minimum:** `60000` (1 minute).  
**Set to `0`** to disable periodic polling (refreshes still happen on session events).

```json
{ "pollIntervalMs": 300000 }
```

### `minRefreshIntervalMs`

Minimum time between two consecutive refresh requests, in milliseconds. Prevents burst refreshes from session events.

**Default:** `120000` (2 minutes).  
**Minimum:** `60000` (1 minute).

```json
{ "minRefreshIntervalMs": 60000 }
```

### `providerCacheTtlMs`

How long a successful provider response is considered fresh before re-fetching, in milliseconds.

**Default:** `300000` (5 minutes).  
**Minimum:** `60000` (1 minute).

```json
{ "providerCacheTtlMs": 600000 }
```

### `providerErrorBackoffMs`

Base backoff duration when a provider returns an error. On consecutive errors the backoff multiplies (×2, ×3, ×4) up to a 1-hour cap.

**Default:** `900000` (15 minutes).  
**Minimum:** `60000` (1 minute).

```json
{ "providerErrorBackoffMs": 300000 }
```

## Environment variables

### OpenCode Go

Required to display the OpenCode Go provider:

```bash
export OPENCODE_GO_WORKSPACE_ID="wrk_..."
export OPENCODE_GO_AUTH_COOKIE="Fe26.2**..."
```

The workspace ID is visible in your dashboard URL: `https://opencode.ai/workspace/<ID>/go`

### OpenRouter

Either set the environment variable or place a JSON file:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

```json
// ~/.config/opencode/openrouter-auth.json
{ "apiKey": "sk-or-v1-..." }
```

### GitHub Copilot and OpenAI

These providers read credentials automatically from `~/.local/share/opencode/auth.json` (the standard OpenCode auth file). No additional setup required if you are already authenticated in OpenCode.

## Development

```bash
npm install
npm run format
npm run format:check
npm test
npm run typecheck
```
