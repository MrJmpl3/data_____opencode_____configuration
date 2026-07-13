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

If technical artifacts are explicitly requested in another language, use a neutral/professional
register unless the user explicitly requests a different tone or regional variant.

Public/contextual comments follow the target context language by default. Explicit user language or
tone overrides win; otherwise use a neutral/professional register unless the target context clearly
calls for another tone or regional variant.

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
- When participating in native final verification, use only the preterminal transaction and
  preserved policy/ledger inputs. Do not require a receipt, bundle, or gate context that can exist
  only after completion.
- Return the exact verification-evidence content with the result so the parent can hash it and
  preserve its preimage for native gate validation.
- For an authority-only preflight denial, both declared commands must not be executed. Record exit
  `125`, empty-output hashes, and exactly these five recovery fields in the strict envelope:

```yaml
authority_only_failure: true
missing_review_authority: true
substantive_failure: false
command_failed: false
observed_authority_revision: sha256:{observed-authority-revision}
test_exit_code: 125
build_exit_code: 125
```

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

CodeGraph-aware worktree placement:

- Create Git worktrees that may need CodeGraph under the user's home directory, preferably as a
  sibling such as `<repo-parent>/<repo-name>-worktrees/<worktree-name>`. Never place a
  CodeGraph-dependent worktree under `/tmp`, `/var/tmp`, or `/tmp/opencode`; generic temporary-work
  guidance does not override this rule.
- Every worktree needs its own `.codegraph/` index. Never copy, symlink, or reuse another checkout's
  index because its root and checked-out bytes may differ.

CodeGraph intelligence surface:

- Prefer the `codegraph_explore` MCP tool when it is available; it returns relevant source, call
  paths, and blast-radius context in one call.
- If the MCP tool is unavailable, invoke the upstream CLI directly. Agents may use its read-only
  intelligence commands: `codegraph status`, `codegraph query`, `codegraph explore`,
  `codegraph node`, `codegraph files`, `codegraph callers`, `codegraph callees`, `codegraph impact`,
  and `codegraph affected`.
- Do not use `gentle-ai codegraph` as a general proxy. Its `init` command exists only to validate
  the project root before initialization; intelligence queries belong to the upstream CLI.
- Never run or recommend destructive or administrative lifecycle commands: `codegraph uninit`,
  `codegraph install`, `codegraph uninstall`, or `codegraph upgrade`. Reserve `codegraph index` for
  explicit index-corruption recovery, never routine use.

Required order for structural/codebase questions:

1. Resolve the project root with `git rev-parse --show-toplevel || pwd`.
2. Confirm the root is a real project/workspace. Do not ask the user before initializing CodeGraph
   in a real project. Do not initialize CodeGraph in `$HOME`, temporary directories, or non-project
   folders.
3. Check for `<project-root>/.codegraph/` before any broad Read/Glob/Grep filesystem exploration.
4. If `.codegraph/` is missing and CodeGraph is enabled/available, immediately run
   `gentle-ai codegraph init --cwd <project-root>` once.
5. Missing .codegraph/ is the trigger to initialize, not a reason to skip CodeGraph. Do not fall
   back just because `.codegraph/` is missing; a missing index is the trigger to lazy-initialize,
   not a reason to skip CodeGraph.
6. Use `codegraph_explore` after initialization, or the read-only upstream CLI commands when MCP
   tools are absent.
7. After edits, rely on watcher auto-sync by default. Run `codegraph sync` only when the watcher is
   disabled or CodeGraph reports stale files that do not refresh normally.
8. Only fall back to normal filesystem tools after CodeGraph initialization or use fails, and
   briefly explain the fallback.

Broad Read/Glob/Grep exploration before this CodeGraph check is explicitly discouraged for
structural/codebase questions.

<!-- /gentle-ai:codegraph-guidance -->
