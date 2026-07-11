---
name: sdd-apply
description:
  'Implement SDD tasks from specs and design. Trigger: orchestrator launches apply for one or more
  change tasks.'
disable-model-invocation: true
user-invocable: false
license: MIT
metadata:
  author: gentleman-programming
  version: '3.0'
  delegate_only: true
---

> **ORCHESTRATOR GATE**: If you loaded this skill via the `skill()` tool, you are the ORCHESTRATOR —
> STOP. Do NOT execute these instructions inline. Do NOT delegate, do NOT call task/delegate, and do
> NOT launch sub-agents. Read this SKILL.md and follow it exactly.

## Purpose

You are an IMPLEMENTER sub-agent. You receive specific tasks and implement them by writing actual
code. Follow the specs and design strictly. Do NOT delegate.

## Rules

- Do NOT delegate, do NOT call task/delegate, do NOT launch sub-agents
- Read max 3 files at a time — if you need more to understand a task, stop and report
  `needs-explore`
- Keep edits minimal and localized to task files
- Consume structured status when provided; stop on `blocked`, `all_done`, or unsafe `actionContext`
- If workload forecast says >400 lines or `Chained PRs recommended`, STOP and return
  `blocked: workload-decision-required`
- If previous apply-progress exists, read it via mem_search + mem_get_observation and MERGE before
  saving
- Focused remediation is the sole `all_done` exception and must bind both evidence blocks to the
  exact lineage_id, generation, fix_batch, and failed_evidence_revision from native status

## Steps

1. Load up to 2 SKILL.md paths passed by orchestrator (only these — do not load additional skills)
2. Read structured status if provided; stop unless apply is ready and edit roots are safe
3. Read the task description and acceptance criteria in spec
4. Read the design decisions
5. Read only files explicitly referenced by the task (max 3 files)
6. Implement code changes — minimal, localized edits
7. Persist progress immediately after each completed task:
   - `engram`: `mem_update` the `sdd/{change-name}/tasks` observation so completed tasks are marked
     `[x]`, then `mem_save` or `mem_update` for `sdd/{change-name}/apply-progress`
   - `openspec`: mark tasks.md checkboxes
   - `hybrid`: both
8. Re-read persisted tasks and verify completed tasks are checked before returning.
9. Return short summary: files changed list, completed tasks, blocked items.

## Return Envelope

```json
{
  "status": "ok|blocked|error",
  "completed_tasks": ["1.1", "1.2"],
  "files_changed": ["path/to/file.ext"],
  "notes": "short text"
}
```

<!-- gentle-ai:codegraph-guidance -->

## CodeGraph

When answering structural or codebase questions, use CodeGraph before broad filesystem searches.
This is a hard ordering rule for repo maps, architecture, call flow, dependencies, symbol
references, impact analysis, and “how does X work” questions.

Required order for structural/codebase questions:

1. Resolve the project root with `git rev-parse --show-toplevel || pwd`.
2. Confirm the root is a real project/workspace. Do not ask the user before initializing CodeGraph
   in a real project. Do not initialize CodeGraph in `$HOME`, temporary directories, or non-project
   folders.
3. Check for `<project-root>/.codegraph/` before any broad Read/Glob/Grep filesystem exploration.
4. If `.codegraph/` is missing and CodeGraph is enabled/available, immediately run
   `gentle-ai codegraph init --cwd <project-root>` once, then use the `codegraph_explore` MCP tool
   or `codegraph explore "..."`.
5. Missing .codegraph/ is the trigger to initialize, not a reason to skip CodeGraph. Do not fall
   back just because `.codegraph/` is missing; a missing index is the trigger to lazy-initialize,
   not a reason to skip CodeGraph.
6. Only fall back after CodeGraph init or CodeGraph use fails. Only fall back to normal filesystem
   tools after CodeGraph init or CodeGraph use fails, and briefly explain the fallback.

Broad Read/Glob/Grep exploration before this CodeGraph check is explicitly discouraged for
structural/codebase questions.

<!-- /gentle-ai:codegraph-guidance -->
