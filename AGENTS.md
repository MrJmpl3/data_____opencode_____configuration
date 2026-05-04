# AGENTS.md

OpenCode configuration workspace at `~/.config/opencode`. Short, verified facts only.

## What's here

- **`opencode.jsonc`** — authoritative config. MCPs enabled: `context7`, `gh_grep`, `github`, `nuxt`. Bash/read permissions defined inline. Plugins: `@gotgenes/opencode-agent-identity`, `@slkiser/opencode-quota`, `@tarquinen/opencode-dcp`, `oh-my-openagent`.
- **`oh-my-openagent.json`** — all agent definitions (sisyphus, oracle, librarian, explore, multimodal-looker, prometheus, metis, momus, atlas, sisyphus-junior, hephaestus), categories (visual-engineering, ultrabrain, deep, quick, unspecified-low/high, writing, artistry), model configs, and experimental flags. This is where agents are actually defined (NOT a `agents/` directory — that does not exist).
- **`commands/`** — workflow commands: `commit-staged.md`, `comment-educational.md`.
- **`skills/`** — 26 user-installed skills (docker suite, Python suite, laravel-best-practices, mysql, postgresql-optimization-patterns, editorconfig-guidelines, documentation-comments-educational).
- **`.temp/.agents/skills/`** — 132 draft/experimental skills (oh-my-openagent catalog). Not user-installed; ignore unless explicitly needed.
- **`dcp.jsonc`** — context compression limits: 70%–90%.
- **`tui.json`** — theme set to `opencode`.
- **`package.json`** — single dependency `@opencode-ai/plugin@1.4.7`.
- **`node_modules/`** — gitignored.

## Gotchas

- **`package.json` is gitignored**. The `.gitignore` excludes it, `bun.lock`, and itself. Changes to `package.json` won't show in git status.
- **No `agents/` directory.** The old `AGENTS.md` claimed it existed — it doesn't. Agents are `oh-my-openagent.json`.
- **No `AGENT_TEMPLATE.md`.** Referenced in old `AGENTS.md` but never existed on disk.
- **No CI, no pre-commit hooks** (all `.sample`). Single `main` branch.
- **`.temp/` files are tracked in git.** These are experimental skill drafts, not temporary.
- **Permissions in `opencode.jsonc`:** `git push *` = ask, `rm *` = ask, `*.env` reads = deny. All other bash and read = allow.

## Working with agents

- Agents live in `oh-my-openagent.json`, not in separate files. Edit that file to change agent models, variants, or prompts.
- The sisyphus agent uses `opencode-go/deepseek-v4-flash` with `ultrawork` variant `max`.
- Oracle uses `thinking: enabled` — allow extra latency for deep reasoning.
- Hephaestus (prompt_append: "Explora a fondo antes de implementar. Cambios pequeños y verificables.") is the heavy implementer; delegate implementation to it.
- Commands (`/commit-staged`, `/comment-educational`) live in `commands/` as Markdown files.

## Working with skills

- User-installed skills are in `skills/` — 26 curated directories. These override built-in defaults.
- Draft skills are in `.temp/.agents/skills/` — not installed, not referenced by config. Treat as a catalog, not active tools.
- Every skill has `SKILL.md` with frontmatter (name, description) and optional `rules/`, `references/`, `assets/` subdirectories.

## Commit convention (from /commit-staged)

Format: `<emoji> <type>(<scope>): <description>`

- Real Unicode emoji (never `:shortcode:`).
- Description in Spanish, lowercase, max 100 chars.
- Scope: smallest meaningful scope from staged files.

Examples:
```
✨ feat(factura): agregar validacion de montos negativos
🐛 fix(tenant): corregir aislamiento de cache en jobs
♻️ refactor(auth): extraer logica de tokens a servicio dedicado
```
