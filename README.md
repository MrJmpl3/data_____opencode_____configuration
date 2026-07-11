# ⚙️ My Complete OpenCode Configuration

<p>
  <a href="https://github.com/MrJmpl3/opencode_____data_____configuration">
    <img src="https://img.shields.io/badge/OPENCODE-CONFIG-2f3136?style=for-the-badge&logo=github&logoColor=white" alt="OpenCode Config" />
  </a>
  <a href="./plugins">
    <img src="https://img.shields.io/badge/READ-THE_PLUGINS-ff2fa3?style=for-the-badge" alt="Read the plugins" />
  </a>
  <a href="./skills">
    <img src="https://img.shields.io/badge/EXPLORE-SKILLS-374151?style=for-the-badge" alt="Explore skills" />
  </a>
  <a href="./tui-plugins">
    <img src="https://img.shields.io/badge/TUI-EXTENSIONS-0f76d8?style=for-the-badge" alt="TUI extensions" />
  </a>
</p>

<!-- README-I18N:START -->

**English** | [Español](./README.es.md)

<!-- README-I18N:END -->

A practical, opinionated OpenCode configuration workspace — custom plugins, reusable skills, TUI
extensions, model helpers, Engram memory integration, and Spec-Driven Development (SDD) workflow
support.

### 🌱 Why this repo exists

If you already use OpenCode, SDD, Engram, or Gentle AI, this repo helps you level up your own stack
without starting from zero. It shows how to organize:

- **global OpenCode behavior** — agents, models, MCP, permissions, LSPs
- **reusable skills** — focused `SKILL.md` files for languages, frameworks, SDD phases, reviews
- **custom runtime plugins** — Engram integration, model variants, RTK rewriting, skill registry
- **TUI status plugins** — quotas, cache, limits, subagent monitor, branding
- **SDD commands and prompts** — full Spec-Driven Development workflow
- **memory integration** — Engram for persistent cross-session context
- **review and workflow automation** — chained PRs, verification gates, judgment day

> 📖 This is a **reference map**: read to understand the setup, copy patterns that fit your
> workflow, and adapt paths or assumptions to your own machine.

### 🚀 Quick start

1. **Open [`opencode.json`](./opencode.json)**  
   Main config: agents, models, MCP servers, permissions, LSPs, plugin loading.
2. **Read [`AGENTS.md`](./AGENTS.md)**  
   Global behavior, session rules, memory protocol, persona, skill-loading.
3. **Explore [`plugins/`](./plugins)**  
   Engram, model variants, RTK rewriting, skill registry — all flat runtime entrypoints.
4. **Explore [`tui-plugins/`](./tui-plugins)**  
   TUI extensions: quotas, cache, limits, branding, subagent status.
5. **Check [`skills/`](./skills)**  
   Reusable instruction modules for everything from SDD phases to security audits.
6. **Check [`commands/`](./commands) and [`prompts/sdd/`](./prompts/sdd)**  
   Command definitions and phase prompts powering the SDD workflow.

### 🧭 Repository map

```text
ROOT
│
├── AGENTS.md              # Global OpenCode behavior and session rules
├── opencode.json          # Main OpenCode configuration
├── tui.json               # TUI plugin configuration
├── SECURITY.md            # Vulnerability reporting policy
│
├── .github/               # Dependabot config
├── commands/              # Custom OpenCode command definitions
├── prompts/
│   └── sdd/               # SDD phase prompts
│
├── skills/                # 221 reusable skill instructions
│   └── _shared/           # Cross-cutting SDD/Engram/skill-resolver conventions
├── plugins/               # 4 OpenCode runtime plugins
├── tui-plugins/           # 2 OpenCode TUI extensions
```

### 🔌 Custom OpenCode plugins

The [`plugins/`](./plugins) directory contains custom OpenCode plugin adapters — flat runtime
entrypoints with zero build step.

| Plugin                                             | What it adds                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`engram.ts`](./plugins/engram.ts)                 | Engram memory integration: starts/connects to the local memory server, captures prompts, injects memory instructions, and avoids subagent session inflation. |
| [`model-variants.ts`](./plugins/model-variants.ts) | Reads model/provider variant data from OpenCode and writes a local cache for Gentle AI.                                                                      |
| [`rtk.ts`](./plugins/rtk.ts)                       | Rewrites shell commands through `rtk rewrite` when available to reduce token usage.                                                                          |
| [`skill-registry.ts`](./plugins/skill-registry.ts) | Refreshes the local skill registry from the flattened plugin entrypoint layout.                                                                              |

### 🖥️ TUI plugins

The [`tui-plugins/`](./tui-plugins) directory contains OpenCode TUI extensions, wired from
[`tui.json`](./tui.json).

| Plugin            | Purpose                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `gentle-logo.tsx` | Gentle AI branding for the TUI.                                                                         |
| `agent-monitor`   | Unified sidebar with limits, cache, quota, subagent, cost, context-fill, speed, and cache-TTL sections. |

### 🧩 Skills

The [`skills/`](./skills) directory is the reusable instruction layer — focused `SKILL.md` files
loaded when a task needs specific behavior. It includes a [`_shared/`](./skills/_shared) layer with
cross-cutting conventions (SDD phase contracts, Engram protocol, skill resolution).

| Category               | Examples                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| SDD workflow           | `sdd-apply`, `sdd-design`, `sdd-tasks`, `sdd-verify`, `_shared/` ...    |
| Code review            | `code-review-excellence`, `judgment-day` (dual blind review)             |
| PRs & commits          | `branch-pr`, `chained-pr`, `work-unit-commits`, `issue-creation`         |
| Languages & frameworks | Laravel, Vue, React, Next.js, Nuxt, Python, TypeScript, Go, Rust, .NET   |
| Testing                | TDD patterns for Laravel (Pest), Python (pytest), JS (Vitest), Go        |
| Security               | API security, attack trees, threat mitigation, anti-reversing            |
| Architecture           | Clean/Hexagonal architecture, ADRs, API design, design systems           |
| Infrastructure         | Docker, Docker Compose, database migration, cost optimization            |
| Skills management      | `skill-creator`, `skill-improver`, `skill-registry`                      |
| Browser automation     | `agent-browser` for web interaction and testing                          |

This keeps `AGENTS.md` smaller while injecting task-specific behavior only when it is useful.

### 🛠️ Commands and SDD workflow

The [`commands/`](./commands) directory defines user-facing workflow commands — SDD lifecycle,
utilities, and code analysis.

| Command file                                      | Purpose                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| [`sdd-new.md`](./commands/sdd-new.md)             | Start a new SDD change.                        |
| [`sdd-explore.md`](./commands/sdd-explore.md)     | Explore an idea before committing to a change. |
| [`sdd-ff.md`](./commands/sdd-ff.md)               | Fast-forward planning phases.                  |
| [`sdd-continue.md`](./commands/sdd-continue.md)   | Continue the next dependency-ready phase.      |
| [`sdd-status.md`](./commands/sdd-status.md)       | Show structured status of an active change.    |
| [`sdd-init.md`](./commands/sdd-init.md)           | Bootstrap SDD context and testing config.      |
| [`sdd-onboard.md`](./commands/sdd-onboard.md)     | Guided walkthrough of the full SDD cycle.      |
| [`sdd-apply.md`](./commands/sdd-apply.md)         | Apply implementation tasks.                    |
| [`sdd-verify.md`](./commands/sdd-verify.md)       | Verify implementation against specs and tasks. |
| [`sdd-archive.md`](./commands/sdd-archive.md)     | Archive completed change artifacts.            |

Other available commands: [`code-audit.md`](./commands/code-audit.md) (source-to-target code analysis),
[`skill-creator.md`](./commands/skill-creator.md) and [`skill-registry.md`](./commands/skill-registry.md)
(skill authoring and indexing).

> 💡 SDD artifacts are stored in **Engram memory** by default, not in file artifacts. The
> `openspec/` convention exists for teams that prefer file-based artifact sharing.

### 🧪 Development notes

This repo has both root-level configuration and package-local TUI plugin projects. Available scripts:

```bash
npm install
npm run format
npm run format:check
npm test
npm run typecheck
```

For package-local checks, run commands inside the relevant plugin directory:

```bash
cd tui-plugins/agent-monitor
npm test
npm run typecheck
```

> ⚠️ **Local paths.** This repo uses absolute paths like `/home/mrjmpl3/.config/opencode` and local
> binaries (`engram`, `rtk`). Before reusing, review: absolute paths, provider/model names, MCP
> config, plugin entrypoints, and shell/Git permissions. Study the structure, copy what fits, adapt
> the rest.

### 🔒 Security

See [`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities.

### 🤝 Contributing

PRs and issues are welcome. This is a living config — if you spot a bug, see an improvement, or
want to add a skill, open an issue first to discuss the approach.

1. Check [open issues](https://github.com/MrJmpl3/opencode_____data_____configuration/issues)
2. Fork and branch from `main`
3. Keep changes focused — one PR per concern
4. Run `npm run format:check` and `npm test` before submitting
