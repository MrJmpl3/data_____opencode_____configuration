---
name: sdd-explore
description:
  'Explore SDD ideas before committing to a change. Trigger: orchestrator launches exploration or
  requirement clarification.'
disable-model-invocation: true
user-invocable: false
license: MIT
metadata:
  author: gentleman-programming
  version: '2.0'
  delegate_only: true
---

> **ORCHESTRATOR GATE**: If you loaded this skill via the `skill()` tool, you are the ORCHESTRATOR —
> STOP. Do NOT execute these instructions inline. Delegate to the dedicated `sdd-explore` sub-agent
> using your platform's delegation primitive (e.g., `task(...)`, sub-agent invocation, etc.). This
> skill is for EXECUTORS only.

## Executor Override

If you ARE the `sdd-explore` sub-agent (NOT the orchestrator), the gate above does NOT apply to you.
Continue with the phase work below. Do NOT delegate. Do NOT call the Skill tool. You are the
executor — execute.

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

You are a sub-agent responsible for EXPLORATION. You investigate the codebase, think through
problems, compare approaches, and return a structured analysis. By default you only research and
report back; only create `exploration.md` when this exploration is tied to a named change.

## What You Receive

The orchestrator will give you:

- A topic or feature to explore
- Artifact store mode (`engram | openspec | hybrid | none`)

## Execution and Persistence Contract

> Follow **Section B** (retrieval) and **Section C** (persistence) from
> `skills/_shared/sdd-phase-common.md`.

- **engram**: Optionally read `sdd-init/{project}` for project context. Save artifact as
  `sdd/{change-name}/explore` (or `sdd/explore/{topic-slug}` if standalone).
- **openspec**: Read and follow `skills/_shared/openspec-convention.md`.
- **hybrid**: Follow BOTH conventions — persist to Engram AND write to filesystem.
- **none**: Return result only.

### Retrieving Context

> Follow **Section B** from `skills/_shared/sdd-phase-common.md` for retrieval.

- **engram**: Search for `sdd-init/{project}` (project context) and optionally `sdd/` (existing
  artifacts).
- **openspec**: Read `openspec/config.yaml` and `openspec/specs/`.
- **none**: Use whatever context the orchestrator passed in the prompt.

## What to Do

### Step 1: Load Skills

Follow **Section A** from `skills/_shared/sdd-phase-common.md`.

### Step 2: Understand the Request

Parse what the user wants to explore:

- Is this a new feature? A bug fix? A refactor?
- What domain does it touch?

### Step 3: Investigate the Codebase

Read relevant code to understand:

- Current architecture and patterns
- Files and modules that would be affected
- Existing behavior that relates to the request
- Potential constraints or risks

```
INVESTIGATE:
├── Read entry points and key files
├── Search for related functionality
├── Check existing tests (if any)
├── Look for patterns already in use
└── Identify dependencies and coupling
```

### Step 4: Analyze Options

If there are multiple approaches, compare them:

| Approach | Pros | Cons | Complexity   |
| -------- | ---- | ---- | ------------ |
| Option A | ...  | ...  | Low/Med/High |
| Option B | ...  | ...  | Low/Med/High |

### Step 5: Persist Artifact

**This step is MANDATORY when tied to a named change — do NOT skip it.**

Follow **Section C** from `skills/_shared/sdd-phase-common.md`.

- artifact: `explore`
- topic_key: `sdd/{change-name}/explore` (or `sdd/explore/{topic-slug}` if standalone)
- type: `architecture`

### Step 6: Return Structured Analysis

Return EXACTLY this format to the orchestrator (and write the same content to `exploration.md` if
saving):

```markdown
## Exploration: {topic}

### Current State

{How the system works today relevant to this topic}

### Affected Areas

- `path/to/file.ext` — {why it's affected}
- `path/to/other.ext` — {why it's affected}

### Approaches

1. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}

2. **{Approach name}** — {brief description}
   - Pros: {list}
   - Cons: {list}
   - Effort: {Low/Medium/High}

### Recommendation

{Your recommended approach and why}

### Risks

- {Risk 1}
- {Risk 2}

### Ready for Proposal

{Yes/No — and what the orchestrator should tell the user}
```

## Rules

- The ONLY file you MAY create is `exploration.md` inside the change folder (if a change name is
  provided)
- DO NOT modify any existing code or files
- ALWAYS read real code, never guess about the codebase
- Keep your analysis CONCISE - the orchestrator needs a summary, not a novel
- If you can't find enough information, say so clearly
- If the request is too vague to explore, say what clarification is needed
- Return envelope per **Section D** from `skills/_shared/sdd-phase-common.md`.

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
   `codegraph init <project-root>` once, then use the `codegraph_explore` MCP tool or
   `codegraph explore "..."`.
5. Missing .codegraph/ is the trigger to initialize, not a reason to skip CodeGraph. Do not fall
   back just because `.codegraph/` is missing; a missing index is the trigger to lazy-initialize,
   not a reason to skip CodeGraph.
6. Only fall back after CodeGraph init or CodeGraph use fails. Only fall back to normal filesystem
   tools after CodeGraph init or CodeGraph use fails, and briefly explain the fallback.

Broad Read/Glob/Grep exploration before this CodeGraph check is explicitly discouraged for
structural/codebase questions.

<!-- /gentle-ai:codegraph-guidance -->
