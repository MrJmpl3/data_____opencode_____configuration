# AGENTS.md

OpenCode workspace at `~/.config/opencode`. High-signal facts for agents.

## Config files

| File                   | Purpose                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `opencode.json`        | MCPs (context7, gh_grep, github, nuxt), LSP config, provider timeouts, plugin load + context-cache plugin |
| `oh-my-openagent.json` | Agent definitions across 4 presets: `opencode-free`, `opencode-go`, `github-copilot`, `openrouter`        |
|                        | `tui.json`                                                                                                | Theme `opencode`, loads `oh-my-openagent` + local `./plugins/quota` |

- `opencode.json` `plugin` field loads remote npm packages: `oh-my-openagent@latest`, `opencode-snip@latest`, `@ramtinj95/opencode-tokenscope@latest`
- `small_model`: `opencode/deepseek-v4-flash-free` (same provider as default)
- `plugins/quota/` — TUI sidebar plugin (TSX, event-driven + polling)

## LSP (from `opencode.json`)

- **oxlint** via `pnpm exec oxlint` for `.js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts`.
- **typescript-language-server** with `NODE_OPTIONS=--max-old-space-size=8192`.

## Git state

- Single `main` branch, no remote configured, no CI, no hooks.
- Everything tracked: config, skills, plugins, commands.
- `package.json`, `bun.lock`, `.gitignore`, `node_modules/`, `tasks/` are gitignored.
- `package.json` changes will NOT appear in `git status`.

## Permissions

- `git push *` = ask
- `rm *` = ask
- `*.env` reads = deny
- Everything else = allow

## Plugins

- **TUI plugin** `plugins/quota/` — renders quota in TUI sidebar (TSX, signals, smart poll + events). Data fetching via `providers.ts` (colocated).

## Commands

- **`/commit-staged`** — `commands/commit-staged.md`. Commits staged files with `<emoji> <type>(<scope>): <description>`. Description in Spanish, lowercase, max 100 chars. Real Unicode emoji (never `:shortcode:`).
- **`/comment-educational`** — `commands/comment-educational.md`. Adds educational comments via the `documentation-comments-educational` skill.

## Skills

Installed skills in `skills/`. Each has `SKILL.md` with frontmatter (name, description) and optional `rules/`, `references/`, `assets/` subdirectories.

## Environment

- Node deps: `@opencode-ai/plugin@1.14.48`, `@opentui/core@0.2.8`, `@opentui/solid@0.2.8`

## Commit convention

Format: `<emoji> <type>(<scope>): <description>`

- Real Unicode emoji (never `:shortcode:`)
- Description in Spanish, lowercase, max 100 chars
- Scope: smallest meaningful scope from staged files

Examples:

```
✨ feat(factura): agregar validacion de montos negativos
🐛 fix(tenant): corregir aislamiento de cache en jobs
♻️ refactor(auth): extraer logica de tokens a servicio dedicado
```
