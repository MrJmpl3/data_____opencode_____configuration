---
description: 🔍 Auto-generates hierarchical AGENTS.md files throughout your project
---

Objective: generate or update hierarchical `AGENTS.md` files across the current project so future agents get precise local context with fewer tokens.

Start by identifying the real project root. If the current directory is `~/.config/opencode`, only continue if the user explicitly wants to document this OpenCode configuration repo; otherwise ask which project directory to scan.

Process:

1. Inspect the repository structure before writing anything.
2. Read existing instruction files first, including `AGENTS.md`, `.opencode/AGENTS.md`, `README*`, contributing docs, package manifests, framework config, build/test scripts, and any existing per-directory `AGENTS.md` files.
3. Identify meaningful boundaries where local agent instructions would reduce context or prevent mistakes: apps, packages, services, frontend/backend roots, infrastructure, test suites, scripts, database/migrations, and framework-specific modules.
4. Ignore generated or third-party directories such as `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `.nuxt`, `coverage`, caches, lockfile-only folders, and large generated artifacts.
5. For each selected directory, create or update an `AGENTS.md` that is short, factual, and scoped only to that subtree.
6. Prefer fewer, higher-signal files over documenting every directory. Do not create an `AGENTS.md` in a directory unless it has conventions that differ from its parent or contains enough complexity to justify local instructions.

Each generated `AGENTS.md` should include only information supported by files in that subtree:

- Purpose and ownership of the directory.
- Important commands relevant to that subtree.
- Architecture or framework conventions agents must follow.
- Testing, linting, migration, build, or deployment notes specific to that subtree.
- Safety constraints, generated-file warnings, or files that should not be edited manually.
- Pointers to nearby docs when they are more authoritative.

Writing rules:

- Preserve useful existing content and merge changes instead of blindly replacing files.
- Keep each file concise. Do not duplicate root-level guidance in child `AGENTS.md` files unless the local override matters.
- Use direct instructions for future agents, not a project essay.
- Do not invent conventions. If something is inferred, state it as an inference or leave it out.
- Do not modify application code while running this command.

Verification:

1. Review the created or changed `AGENTS.md` files for contradictions and unnecessary duplication.
2. Run a lightweight status/diff check so the user can see exactly which instruction files changed.
3. Report the files created or updated, the directories intentionally skipped, and any uncertainty that should be confirmed by the user.
