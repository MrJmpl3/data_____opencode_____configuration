# plugins-tui/quota — TUI Sidebar Quota Panel

OpenCode TUI plugin showing real-time quota from configured providers, with OpenCode Go, GitHub Copilot, OpenRouter, and optional OpenAI support. Event-driven refresh with smart polling fallback.

## Structure

```
quota/
├── AGENTS.md              # this file
├── index.tsx              # plugin entry — typed sidebar render + orchestration
├── providers.ts           # typed fetch/parse for quota providers
├── refresh-scheduler.ts   # (56 lines) — typed event binding + timer management
└── package.json           # name: @my/quota-tui, export: ./tui → ./index.tsx

## Event Refresh Strategy

| Event Group | Events | Extra Delay | Purpose |
|-------------|--------|-------------|---------|
| `IMMEDIATE_REFRESH` | `tui.session.select` | none | Session switch |
| `COMPLETION_REFRESH` | `session.idle` | +250ms | LLM finished / settle lag |
- Base delays: `[150, 600]`ms per event
- Completion events add an extra 250ms stagger
- `refresh()` uses `inFlightVersion` guard to discard stale responses
- All timers tracked in `pendingTimers` Set, cleared on dispose
- Poll every 120s as fallback (resets on event)
- Per-provider loading states with emoji indicators (⏳✅❌)
## Data Layer (providers.ts)

- **OpenCode Go**: scrapes HTML dashboard from `opencode.ai/workspace/{id}/go` — parses `$R[...]` window objects
- **GitHub Copilot**: reads OAuth token from `auth.json`, queries `/copilot_internal/user`
- **OpenRouter**: reads API key from env or config, queries `/api/v1/credits`
- **OpenAI**: reads OAuth token from `auth.json`, queries `chatgpt.com/backend-api/wham/usage`
## Key Patterns

- `disposed` flag + version guard prevents work after unmount
- `scheduleRefresh()` creates staggered timers, each self-removes from `pendingTimers`
- `subscribe()` wrapper enables event logging + poll reset per event
- Per-provider results map with inline loading/error/data rendering
- Reactive `View` component using SolidJS `createSignal` + `<Show>`
- Visibility and compact mode are configured via plugin options in `tui.json`, e.g. `["./plugins/quota", { "compact": true, "visibleProviders": ["copilot", "openrouter", "openai"] }]`
## Anti-Patterns (this plugin)
- Do NOT add new provider fetchers inside `index.tsx` — put them in `providers.ts`
- Do NOT add setTimeout/timer logic outside `refresh-scheduler.ts`
- Do NOT remove the `disposed` guard — it prevents post-unmount crashes
- Do NOT use `as any` or `@ts-ignore` — keep the TSX file type-safe
- Do NOT refresh on every session update — use `session.idle` + poll only
```
