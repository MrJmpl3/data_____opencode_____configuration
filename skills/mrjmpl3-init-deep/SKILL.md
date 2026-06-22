---
name: mrjmpl3-init-deep
description:
  'Trigger: init deep, agents.md, generar agents, generate agents, hierarchical agents, project
  context. Generate or update hierarchical AGENTS.md files with real project context so agents get
  precise local instructions with fewer tokens.'
license: Apache-2.0
metadata:
  author: mrjmpl3
  version: '1.0'
---

## When to Use

Use this skill when generating or updating hierarchical `AGENTS.md` files across a project. Activate
it when the goal is to give agents precise local context per directory subtree.

Do NOT use it for modifying application code — this skill only generates instruction files.

## Critical Rules

| Rule | Explanation |
| --- | --- |
| Identify project root first | If inside `~/.config/opencode`, only proceed if the user explicitly confirms. Otherwise ask which project to scan. |
| OpenCode repo is special | If the target IS this OpenCode config repo, read `oh-my-opencode-slim.json`, `opencode.jsonc`, and `tui.jsonc` before drafting. |
| Read before writing | Inspect existing `AGENTS.md`, `.opencode/AGENTS.md`, `README*`, contributing docs, manifests, and config files. |
| Do not modify application code | This command generates instruction files only — never touch source code. |
| Preserve useful content | Merge with existing `AGENTS.md` content instead of blindly replacing it. |
| No invention | Do not invent conventions; if something is inferred, state it as an inference or leave it out. |

## Execution Steps

1. Identify the real project root. If the current directory is `~/.config/opencode`, ask the user
   which project to scan unless the request explicitly targets this OpenCode config repo.
2. Load matching skills before writing: load `customize-opencode` when the target is OpenCode config;
   load `scan` when it clearly fits broad AGENTS generation.
3. Read existing instruction files: `AGENTS.md`, `.opencode/AGENTS.md`, `README*`, contributing docs,
   package manifests, framework config, build/test scripts, and any existing per-directory
   `AGENTS.md`.
4. If the target is this OpenCode config repo, also read `oh-my-opencode-slim.json`,
   `opencode.jsonc`, and `tui.jsonc` as source-of-truth files.
5. Identify meaningful boundaries for local agent instructions: apps, packages, services,
   frontend/backend roots, infrastructure, test suites, scripts, database/migrations, and
   framework-specific modules.
6. Ignore generated or third-party directories: `.git`, `node_modules`, `vendor`, `dist`, `build`,
   `.next`, `.nuxt`, `coverage`, caches, lockfile-only folders, and large generated artifacts.
7. For each selected directory, create or update an `AGENTS.md` that is short, factual, and scoped
   only to that subtree.
8. Prefer fewer, higher-signal files over documenting every directory. Do not create an `AGENTS.md`
   unless the directory has conventions that differ from its parent or contains enough complexity to
   justify local instructions.

## Content Rules for Each `AGENTS.md`

Each generated file should include only information supported by files in that subtree:

- Purpose and ownership of the directory
- Important commands relevant to that subtree
- Architecture or framework conventions agents must follow
- Testing, linting, migration, build, or deployment notes specific to that subtree
- Safety constraints, generated-file warnings, or files that should not be edited manually
- Pointers to nearby docs when they are more authoritative

Writing rules:

- Preserve useful existing content — merge, do not replace.
- Keep each file concise. Do not duplicate root-level guidance in child files unless the local
  override matters.
- Use direct instructions for future agents, not a project essay.
- Do not invent conventions. If something is inferred, state it as an inference or leave it out.

## Verification

1. Review the created or changed `AGENTS.md` files for contradictions and unnecessary duplication.
2. Run a lightweight status/diff check to show which instruction files changed.
3. Report the files created or updated, the directories intentionally skipped, and any uncertainty
   that should be confirmed by the user.
