---
description: Deeply analyze and improve target structure and reasoning
---

Objective: inspect the target carefully, challenge weak structure, naming, and reasoning, and produce the strongest practical improvement for the situation.

Arguments:

- `$ARGUMENTS` can be a file path, directory path, prompt, or natural-language request.

Steps:

1) If `$ARGUMENTS` is empty, stop immediately and report:
    "Please provide a target file, directory, prompt, or request. Example: `/deep-restructure path/to/thing`"
2) Identify what `$ARGUMENTS` is trying to improve and what output it should produce. If it is a natural-language request, infer the intended target from repo context and keep the scope as small as possible.
3) Before changing anything, load and follow any relevant skill or repository guidance for the stack involved.
4) Before changing anything, read the target fully when it is a file, or inspect the relevant files when it is a directory.
5) Analyze the target and separate:
   - what works
   - what is weak, unclear, duplicated, inconsistent, or incomplete
   - what is driving the shallow result
   - what must remain unchanged
6) Choose the smallest change that materially improves clarity, structure, and intent:
   - simplify the core structure
   - improve naming, flow, and hierarchy
   - remove unnecessary noise
   - avoid extra abstractions unless they solve a real problem
7) If the target is code or configuration:
   - preserve behavior unless the user explicitly wants behavior changes
   - prefer refactoring weak parts over rewriting everything
8) If the target is a prompt, spec, or document:
   - rewrite it so it is more precise, demanding, and resistant to shallow answers
   - remove vague wording and replace it with concrete expectations
9) If the target is a directory:
   - inspect first, then touch only files that genuinely need work
   - skip generated files, vendored code, dependencies, lockfiles, build artifacts, and binaries
   - keep the scope as small as possible while still making the improvement meaningful
   - prefer role-based, natural names over robotic or over-specified names
   - do not rename just to satisfy personal taste
   - do not split directories unless the current layout is actually creating confusion
   - keep related files together when they serve one responsibility
10) If the current structure is already good according to the relevant skill, stop and report that no change is needed.
11) If the relevant skill suggests the current structure is fine, but your own reasoning suggests a meaningful improvement, do not apply the change yet. Stop and ask for confirmation, clearly describing:
    - what the skill favors
    - what improvement you would make
    - why this is a judgment call instead of a clear fix
12) If the structure is clearly weak and there is no conflict with the relevant skill, apply the improvement with these constraints:
    - rename only the files and directories that truly need it
    - update all references
    - avoid compatibility aliases or legacy paths unless explicitly requested
    - keep naming consistent across the touched area
13) When the best outcome is ambiguous, explain the trade-off and ask before making a risky move.
14) After editing or rewriting, verify that:
    - the output is materially stronger than the original
    - there is no leftover shallow wording or weak structure
    - formatting, syntax, and intent remain consistent
15) Return a short summary of:
    - what was improved
    - what was intentionally left alone
    - any trade-off or judgment call that mattered

Constraints:

- Do not make cosmetic changes that do not improve the result.
- Do not pad the output with generic advice.
- Do not dilute the request into a light edit when a deep rework is clearly needed.
- Do not change unrelated files.
- Do not invent requirements the user did not ask for.
- Do not override relevant skill guidance silently.
- Do not create legacy compatibility layers unless explicitly requested.

## Output style

- direct
- sharp
- thoughtful
- technically grounded
- focused on real improvement, not polite minimalism
