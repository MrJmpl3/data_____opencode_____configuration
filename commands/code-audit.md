---
description:
  Full codebase audit — dead code, over-engineering, YAGNI, clean code, simplification, security,
  error-handling, perf, architecture, tests, dependencies, consistency, comments. Configurable
  scope, checks, and severity.
---

You are the `gentle-orchestrator`, not an executor. This command scans the target codebase across 13
quality dimensions: dead code, over-engineering, YAGNI, clean code, simplification, security, error
handling, performance, architecture, testing quality, dependencies, consistency, and comment health.
Each dimension is independently enabled/disabled via `--checks`. Delegate ALL actual analysis to
sub-agents; do not do the work inline.

## Context

- **Working directory**: before anything else, run
  `git rev-parse --show-toplevel 2>/dev/null || pwd` and use the returned path as the authoritative
  workspace.
- **Arguments**: `$ARGUMENTS`

## Configuration Resolution

Parse `$ARGUMENTS` to extract optional parameters:

```
/code-audit                                    → interactive (ask everything)
/code-audit src/                               → scan src/ only
/code-audit --checks dead-code,yagni           → all paths, only dead-code + YAGNI
/code-audit src/ --severity high               → src/ only, high severity and above
/code-audit src/ --checks dead-code --severity medium
```

Supported check values: `dead-code`, `over-engineering`, `yagni`, `clean-code`, `simplification`,
`security`, `error-handling`, `performance`, `architecture`, `testing`, `dependencies`,
`consistency`, `comments`, `all` (default).

Supported severity values: `critical`, `high`, `medium`, `low` (default: `medium`).

Output format: `table`, `detailed`, `summary` (default: `detailed`).

If `$ARGUMENTS` is empty or missing required params, ask clarifying questions via the `question`
tool before launching analysis. Ask at most **one question at a time** — start with scope, then
checks if still ambiguous.

## Hard Rules

- **Read-only audit**: never modify code during this command. Findings only.
- **Use CodeGraph first** before broad filesystem scanning — call `codegraph_explore` with the
  target scope to get a structural map of symbols, files, and dependencies before running
  grep/ast-grep scans.
- **Delegate heavy lifting**: scanning 4+ files or running complex pattern searches must be
  delegated to sub-agents, not done inline in the orchestrator.
- **Classify every finding** with: `severity` (CRITICAL | HIGH | MEDIUM | LOW), `category`,
  `file:line`, `description`, and `suggested_fix`.
- **No invented findings**: every claim must cite specific code evidence (file, line number,
  symbol). Vague findings should be excluded.
- **Respect scope**: never scan outside the target path, and surface a scope summary before
  starting.

## Check Definitions

### Dead Code Detection

Unused exports, unreachable branches, commented-out blocks, orphaned functions (no callers), unused
parameters, unused imports, dead CSS, unused dependencies in config files.

### Over-engineering Detection

Unnecessary abstractions (factory-of-factory, interface-for-one-implementation), excessive
indirection, over-parameterized generics, layers with no current consumer, pattern dogma without
demonstrated need.

### YAGNI Detection

Speculative code ("we might need this later"), pre-built extension points never called,
configuration keys for features that don't exist, extra conditional branches for unimplemented
cases, over-abstracted "future-proof" structures.

### Clean Code Violations

Functions over 50 lines, nesting beyond 3 levels, magic numbers/strings, unclear naming
(single-letter outside loops, misleading names), files over 400 lines, parameters exceeding 4,
functions with multiple responsibilities, commented-out code, missing error handling.

### Simplification Opportunities

Redundant conditionals (`if (x) true else false`), manual loops replaceable with built-ins (`map`,
`filter`, `reduce`), duplicated code blocks, verbose expressions with simpler equivalents,
unnecessary temporary variables.

### Security — Secrets & Injection

Secrets hardcoded (API keys, tokens, passwords, JWTs, DB connection strings). SQL/NoSQL injection
via string concatenation. XSS — user input reaching HTML/VDOM sinks without escaping. AuthZ enforced
only in frontend — backend must verify every request. Cookies missing `httpOnly`, `secure`, or
`sameSite` flags. Weak crypto (MD5, SHA1 for passwords, `Math.random()` for tokens). Insecure direct
object references.

### Error Handling — Silent Failures & Robustness

Promises without catch, async functions without try-catch. Errors silenced in empty catch blocks.
Errors logged without context (message only, no stack trace). Missing error boundaries in UI
component trees. Failed chains with no rollback or compensation step. Swallowed exceptions in event
handlers, callbacks, or stream pipelines. Unhandled promise rejections.

### Performance — Speed & Efficiency

N+1 queries — DB or API calls inside loops. Expensive operations in loops (DOM queries, crypto, sync
I/O). Bundle bloat — importing entire libraries instead of tree-shakeable modules
(`import * from 'lodash'` instead of `import { get } from 'lodash/es'`). Missing memoization in
expensive computations or re-renders. Large static assets that should be lazy-loaded, cached, or
compressed. Unnecessary re-renders — missing key props, inline handlers in React/Vue renders.

### Architecture — Structure & Boundaries

Circular dependencies between modules. Layer violations — UI/controller importing infrastructure or
DB code directly. God classes or god files exceeding 500 lines. Deep relative imports
(`../../../../`) indicating broken module boundaries. Mixed responsibilities in a single module
(data fetching + rendering + validation). Project structure drift from the established conventions.
Missing or bloated interfaces.

### Testing — Test Quality & Coverage (skip if project has no test framework)

Exported functions with zero test coverage. Test files with no assertions or with always-passing
assertions. Overly specific mocks coupled to implementation details (test breaks on refactor without
behavior change). High coverage in trivial code (getters/setters/config) but uncovered business
logic. Orphaned test files referencing deleted or renamed production code. Tests relying on
`test.only`/`it.only` that pass CI for the wrong reasons. Integration/E2E tests where cheaper unit
tests would suffice.

### Dependencies — Third-Party Risk

Unused dependencies in `package.json`, `composer.json`, `requirements.txt`, `go.mod`, etc. Known
vulnerable packages (check against OSV/GitHub Advisory DB). Deprecated APIs in active use. Duplicate
dependencies with conflicting versions. Development dependencies shipped in production bundles.
Overly permissive version ranges (`*`, `>=`) that risk supply-chain breaks.

### Consistency — Style & Convention Drift

Mixed case conventions in the same project (camelCase vs snake_case vs kebab-case). Mixed
import/export styles — default + named inconsistently in the same module. Formatting drift — tabs in
one file, spaces in another. Mixed async patterns — Promises and async/await used interchangeably in
adjacent code. Inconsistent naming for the same domain concept across modules (e.g. `User`,
`Account`, `Customer` for the same entity). Copied code that diverged from the original pattern.

### Comments — Signal vs Noise

Comments that state the obvious (`i++ // increment i`). Massive comment blocks (20+ lines)
explaining trivial code. Stale/outdated comments where the code changed but the comment didn't.
Commented-out code blocks left as artifacts. TODO/FIXME without tracking reference (issue number,
ticket, or owner). Overly verbose explanations that should be simplified code instead. Missing "why"
comments on non-obvious decisions — a comment absence, not presence, problem.

## Execution Steps

1. **Resolve configuration**: parse `$ARGUMENTS`, ask questions if ambiguous, confirm scope with a
   brief summary.
2. **Map the scope**: run `codegraph_explore` on the target path to get a structural overview —
   files, symbols, call relations. Use this as the baseline for dead-code and over-engineering
   checks.
3. **Delegate analysis by check type**:
   - For each enabled check, launch a focused sub-agent task with:
     - The check's rules (from the definition above)
     - The target scope (path + file list from CodeGraph)
     - The minimum severity to report
     - Explicit instruction to return findings with file:line evidence
   - Run independent checks as parallel sub-agents where possible to minimize wall time.
4. **Aggregate results**: merge findings from all sub-agents, deduplicate, and sort by severity.
5. **Report**: return the structured audit report (see Output Contract).

## Output Contract

Return a structured report with this shape:

```
## Code Audit Results — {scope}

### Configuration
- Path: {resolved path}
- Checks: {selected checks}
- Severity threshold: {minimum severity}
- Files analyzed: {count}

### Summary
| Category          | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-------------------|----------|------|--------|-----|-------|
| Dead Code         | {n}      | {n}  | {n}    | {n} | {n}   |
| Over-engineering  | {n}      | {n}  | {n}    | {n} | {n}   |
| YAGNI             | {n}      | {n}  | {n}    | {n} | {n}   |
| Clean Code        | {n}      | {n}  | {n}    | {n} | {n}   |
| Simplification    | {n}      | {n}  | {n}    | {n} | {n}   |
| Security          | {n}      | {n}  | {n}    | {n} | {n}   |
| Error Handling    | {n}      | {n}  | {n}    | {n} | {n}   |
| Performance       | {n}      | {n}  | {n}    | {n} | {n}   |
| Architecture      | {n}      | {n}  | {n}    | {n} | {n}   |
| Testing           | {n}      | {n}  | {n}    | {n} | {n}   |
| Dependencies      | {n}      | {n}  | {n}    | {n} | {n}   |
| Consistency       | {n}      | {n}  | {n}    | {n} | {n}   |
| Comments          | {n}      | {n}  | {n}    | {n} | {n}   |
| **Total**         | **{n}**  | **{n}**| **{n}**| **{n}**| **{n}** |

### Findings

#### {severity} — {file}:{line}
- **Category**: {one of the 13 check names}
- **Description**: {what is wrong}
- **Evidence**: {specific code reference}
- **Suggested fix**: {how to resolve}

...

### Recommendations
- {top 3-5 actionable recommendations by impact}
```

If the scan found zero issues for the given scope and severity, say exactly:
`No findings for scope "{scope}" at severity "{threshold}" or above.`
