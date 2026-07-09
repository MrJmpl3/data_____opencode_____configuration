---
description:
  Full codebase audit — dead code, over-engineering, YAGNI, clean code, simplification, security,
  error-handling, perf, architecture, tests, dependencies, consistency, comments, readability, SOLID,
  observability, data integrity, concurrency, configuration hygiene, production readiness.
  Configurable scope, checks, and severity.
---

You are the `gentle-orchestrator`, not an executor. This command scans the target codebase across 20
quality dimensions: dead code, over-engineering, YAGNI, clean code, simplification, security, error
handling, performance, architecture, testing quality, dependencies, consistency, comments,
readability, SOLID, observability, data integrity, concurrency, configuration hygiene, and
production readiness.
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
/code-audit                                              → ask everything
/code-audit src/                                         → scope known, ask checks + severity + format
/code-audit --checks dead-code,yagni                     → checks known, ask scope + severity + format
/code-audit src/ --severity high                         → scope + severity known, ask checks + format
/code-audit src/ --checks dead-code --severity medium     → all known, run directly
/code-audit src/ --checks all --severity low --output detailed
```

Supported check values: `dead-code`, `over-engineering`, `yagni`, `clean-code`, `simplification`,
`security`, `error-handling`, `performance`, `architecture`, `testing`, `dependencies`,
`consistency`, `comments`, `readability`, `solid`, `observability`, `integrity`, `concurrency`,
`config-hygiene`, `production-readiness`, `all`.

Supported severity values: `critical`, `high`, `medium`, `low`.

Output format: `table`, `detailed`, `summary`.

For **every** parameter not explicitly provided in `$ARGUMENTS`, ask the user via the `question`
tool — scope, checks, severity, and output format each default to *ask* when missing. Never assume
a default unless the user explicitly stated it. Ask at most **one question at a time** — start with
scope, then checks, then severity, then format.

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

### Readability — Code Flow & Cognitive Load

Poorly named identifiers (vague abbreviations, inconsistent terminology, misleading names). Functions
that require reading the entire body to understand intent — missing intention-revealing names at
extraction points. Deeply nested control flow that forces the reader to track multiple mental state
variables. Long conditionals that could be replaced with well-named predicate functions or guard
clauses. Inconsistent formatting that obscures structure (alignment, blank lines, grouping). Missing
vertical spacing between logical sections. Side effects hidden inside functions that appear pure.
Overloaded functions/methods that do different things based on parameter combinations without clear
documentation.

### SOLID Principles — Design Quality

**SRP** — Single Responsibility: classes/modules with multiple unrelated reasons to change. Methods
doing more than one thing at different abstraction levels.

**OCP** — Open/Closed: switch/if-else chains that grow with every new variant instead of polymorphic
dispatch or strategy pattern. Core logic that requires editing existing code to extend.

**LSP** — Liskov Substitution: subclass overrides that weaken preconditions, strengthen postconditions,
or throw unexpected exceptions. `isinstance` checks that break polymorphism.

**ISP** — Interface Segregation: interfaces with methods that many implementors leave empty or throw
`NotImplementedError`. Callers depending on methods they don't use.

**DIP** — Dependency Inversion: high-level modules importing low-level implementation details
directly. Concrete instantiation inside business logic (`new HttpClient()` inside a service).
Static/class method coupling to concrete dependencies.

### Observability — Logging, Metrics & Tracing

`except Exception: pass` without any logging. Log messages without correlation identifiers
(`request_id`, `session_id`, `user_id`). Critical code paths (auth decisions, payment mutations,
state transitions) with zero logging. Logging inside hot loops that would flood disk on production
load. Exception logging without stack trace or context (message-only). Missing health-check
endpoints or readiness probes. Application metrics absent for key business or technical indicators
(throughput, latency, error rate). Distributed tracing breadcrumbs missing across async/service
boundaries.

### Data Integrity — Validation, Transactions & Idempotency

Input validation only on the client/frontend — backend trusts unsanitized data. Multi-write
operations (DB + file system + external API) without transaction or compensation rollback. State
mutations via `UPDATE`/`PUT` that assume the previous state without version/etag checks. Missing
uniqueness constraints at the DB level that the application code assumes. File writes without atomic
rename or fsync — partial writes survive crashes. Endpoints lacking idempotency keys (`Idempotency-Key`
header or similar) where client retry would cause duplicates. Silent truncation or type coercion
that loses data (float→int, `VARCHAR(255)` overflow).

### Concurrency — Race Conditions & Async Safety

Mutable shared state without synchronization (lock, semaphore, or channel). Lazy initialization
without double-checked locking or `once.Do` equivalent. Promises/futures launched and forgotten
without error handling (fire-and-forget). Unsafe iteration over collections being mutated
concurrently (`ConcurrentModificationError`). Callbacks or event handlers that close over mutable
loop variables. Async code using blocking I/O or `time.sleep()` — blocking the event loop.
Deadlock potential from nested or out-of-order lock acquisition. Assumptions about single-threaded
execution that break under load or in async contexts.

### Configuration Hygiene — Setup & Environment

Hardcoded values that should be configurable (`localhost`, hardcoded ports, API URLs, timeouts,
secret paths). Environment variables without validation, type coercion, or defaults — app crashes
with cryptic errors on missing config. Configuration keys defined but never read (dead config).
Duplicate configuration across multiple files that can drift. Missing or stale `.env.example` /
`.env.dist` — onboarding friction. Configuration without schema or typing (strings where enums or
numbers belong). Environment-specific overrides without a documented mechanism — dev/staging/prod
configuration drift.

### Production Readiness — Clean, Professional & Safe

Debug artifacts left in production code (`print`, `console.log`, `debugger`, `var_dump`, `dd()`).
Lint/type suppressions (`# noqa`, `// eslint-disable-next-line`) without an inline justification.
Overly clever or terse code that sacrifices clarity for brevity — a junior should be able to read
and modify it confidently. Code that mixes languages, idioms, or paradigms inconsistently within
the same module. Missing input validation at public API boundaries (network, file, IPC). Temporary
workarounds, hotfixes, or patches without a TODO/FIXME referencing a tracking ticket. Monkeys
patches, `eval`/`exec`, or metaprogramming tricks without explanation and safety review. Public
API surface that leaks implementation types — consumers couple to internals.

## Execution Steps

1. **Resolve configuration**: parse `$ARGUMENTS`, ask questions if ambiguous, confirm scope with a
   brief summary.
2. **Map the scope**: run `codegraph_explore` on the target path to get a structural overview —
   files, symbols, call relations. Use this as the baseline for dead-code and over-engineering
   checks.
3. **Delegate analysis to review sub-agents**:
   - Map enabled checks to the appropriate review sub-agent and launch one per group:
      - `review-readability`: dead-code, over-engineering, yagni, clean-code, simplification,
        consistency, comments, readability, solid, production-readiness
      - `review-reliability`: error-handling, performance, testing, integrity, concurrency,
        config-hygiene
      - `review-resilience`: observability
      - `review-risk`: security, dependencies, architecture
   - Each review sub-agent receives:
     - The check's rules (from the definition above)
     - The target scope (path + file list from CodeGraph)
     - The minimum severity to report
     - Explicit instruction to return findings with file:line evidence
   - Run independent review sub-agents in parallel where possible.
   - Do NOT use `sdd-explore`, `sdd-propose`, or other SDD sub-agents for analysis.
4. **Aggregate & persist results**: merge findings from all review sub-agents, deduplicate, and sort
   by severity. The orchestrator then writes all findings to `{scope}/TODO.md` as a markdown
   checklist with `- [ ]` checkboxes for progress tracking. Each finding includes severity, category,
   file:line, description, and suggested fix. Example:

   Se asigna un ID único por hallazgo con prefijo según categoría (CC, DC, SM, SC, etc.) y
   correlativo. El TODO.md incluye: generación con fecha y subagentes, configuración del análisis,
   tabla resumen, task list por severity con checkboxes y subcategorías, progress counters, y
   recomendaciones. Formato completo:

   ```markdown
   # Code Audit Results — {scope}

   > Generado el {date} por `gentle-orchestrator` con subagentes `review-readability`,
   > `review-risk`, `review-reliability`, `review-resilience`

   ## Configuration

   - **Path**: {resolved path}
   - **Scope**: {scope directories}
   - **Checks**: {selected checks}
   - **Severity threshold**: {minimum severity}
   - **Files analyzed**: {count} archivos

   ---

   ## Summary

   | Category          | CRITICAL | HIGH | MEDIUM | LOW | Total |
   |-------------------|----------|------|--------|-----|-------|
   | {category}        | {n}      | {n}  | {n}    | {n} | {n}   |
   | **Total**         | **{n}**  | **{n}**| **{n}**| **{n}**| **{n}** |

   ---

   ## Task List

   ### 🔴 CRITICAL

   - [ ] **{ID}** — `{file}:{line}` — {description}

   ### 🟠 HIGH

   #### {Category Name}

   - [ ] **{ID}** — `{file}:{line}` — {description}

   ### 🟡 MEDIUM

   ...

   ### 🟢 LOW

   ...

   ---

   ## Progress

   - **CRITICAL**: `0 / {n}`
   - **HIGH**: `0 / {n}`
   - **MEDIUM**: `0 / {n}`
   - **LOW**: `0 / {n}`
   - **Total**: `0 / {total}`

   ---

   ## Recommendations

   1. **{priority}** — {recommendation}
   ```

   El TODO.md es un archivo vivo: el equipo puede ticar casillas conforme resuelve hallazgos.
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
| Readability       | {n}      | {n}  | {n}    | {n} | {n}   |
| SOLID             | {n}      | {n}  | {n}    | {n} | {n}   |
| Observability     | {n}      | {n}  | {n}    | {n} | {n}   |
| Data Integrity    | {n}      | {n}  | {n}    | {n} | {n}   |
| Concurrency       | {n}      | {n}  | {n}    | {n} | {n}   |
| Config Hygiene    | {n}      | {n}  | {n}    | {n} | {n}   |
| Production Ready  | {n}      | {n}  | {n}    | {n} | {n}   |
| Consistency       | {n}      | {n}  | {n}    | {n} | {n}   |
| Comments          | {n}      | {n}  | {n}    | {n} | {n}   |
| **Total**         | **{n}**  | **{n}**| **{n}**| **{n}**| **{n}** |

### Findings

#### {severity} — {file}:{line}
- **Category**: {one of the 20 check names}
- **Description**: {what is wrong}
- **Evidence**: {specific code reference}
- **Suggested fix**: {how to resolve}

...

### Recommendations
- {top 3-5 actionable recommendations by impact}
```

If the scan found zero issues for the given scope and severity, say exactly:
`No findings for scope "{scope}" at severity "{threshold}" or above.`
