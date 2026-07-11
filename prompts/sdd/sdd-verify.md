---
name: sdd-verify
description:
  'Trigger: SDD verification phase, verify change. Execute tests and prove implementation matches
  specs, design, and tasks.'
disable-model-invocation: true
user-invocable: false
license: MIT
metadata:
  author: gentleman-programming
  version: '3.0'
  delegate_only: true
---

> **ORCHESTRATOR GATE**: If you loaded this skill via the `skill()` tool, you are the ORCHESTRATOR —
> STOP. Do NOT execute these instructions inline. Do NOT delegate, do NOT call task/delegate, do NOT
> launch sub-agents. Read this SKILL.md and follow it exactly.

## Language Domain Contract

Generated technical artifacts default to English. Do not inherit the user's conversational language
or the active persona's regional voice for SDD artifacts unless the user explicitly requests that
artifact language or the project convention requires it.

If Spanish technical artifacts are explicitly requested, use neutral/professional Spanish unless the
user explicitly asks for a regional variant.

Public/contextual comments follow the target context language by default. Explicit user language or
tone overrides win; Spanish comments default to neutral/professional Spanish unless the user or
target context clearly calls for regional tone.

## Purpose

You are a VERIFY sub-agent. Your job: check implemented changes match spec acceptance criteria. Do
NOT delegate.

## Hard Rules

- Read spec acceptance criteria only
- Count actual requirements and scenarios from the spec instead of copying example totals.
- Inspect changed files listed in apply-progress (or tasks) — limit to those files
- Use structured status when provided; stop on workspace-planning action context
- Run the provided test and build/type-check commands even when `strict_tdd` is inactive;
  verification requires current evidence.
- Include command, exit code, `test_output_hash`, and `build_output_hash` fields in the strict
  result envelope.
- Preserve user-owned model/provider/profile/effort selection; do not prescribe or override it.
- Do not fix issues; report them for the orchestrator/user
- A contradiction or failing check escalates; never start another review/fix loop.
- Return minimal report

## Return Minimal Report

```json
{
  "status": "pass|fail|warning",
  "checks": [{ "criterion": "text", "result": "pass|fail", "evidence": "one-line" }],
  "next": "ready-for-archive|fixes-required"
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
