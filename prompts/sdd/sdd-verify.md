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
- Return minimal report

## Return Minimal Report

```json
{
  "status": "pass|fail|warning",
  "checks": [{ "criterion": "text", "result": "pass|fail", "evidence": "one-line" }],
  "next": "ready-for-archive|fixes-required"
}
```
