---
description: 🧠 Corrige comentarios cambiados para que queden claros, útiles y sin AI slop
---

Objective: improve comment quality in the current diff or requested files by applying direct fixes so the code reads like a senior wrote it.

Scope selection:

1. If the user named specific files, limit fixes to changed comments in those files unless the user explicitly asked for full-file cleanup.
2. Otherwise prefer staged changes.
3. If there are no staged changes, fix comments in unstaged changes.
4. If there is no diff or explicit file scope to fix, ask the user which files or diff to inspect and stop.

Before fixing:

1. Inspect the changed files and enough surrounding context to judge each comment fairly.
2. Load any clearly matching skills for the language, framework, or tooling involved.
3. Obey repo `AGENTS.md`, local `AGENTS.md`, and loaded skills over this command when they provide more specific comment or documentation guidance.
4. Evaluate each comment mentally before editing, then apply only high-confidence changes.

Fix rules:

- Review inline comments, block comments, docblocks, docstrings, JSDoc/TSDoc, and framework-specific comments.
- Remove comments that merely restate the code, narrate obvious steps, explain basic syntax, or sound like generic AI exposition.
- Prefer comments that explain why, constraints, invariants, tradeoffs, edge cases, business rules, performance concerns, safety concerns, framework quirks, or external protocol requirements.
- Prefer concise, specific wording over broad explanation.
- Prefer deleting a weak comment over rewriting it when the code is already clear.
- Rewrite a comment only when a materially better version is obvious.
- Keep rewritten comments shorter, more specific, and more constraint-focused than the original.
- Preserve comments required by tooling, typing, linting, framework conventions, or public API documentation unless they are misleading or materially improvable.
- Do not add comments where clearer naming or simpler code would remove the need.
- Do not nitpick when a comment is acceptable and causes no real maintenance issue.
- If a relevant skill recommends a stricter or different convention, follow the skill.
- Do not refactor code just to avoid a comment unless the user explicitly asked for code cleanup too.

Common comment smells:

- Redundant “what the code does” comments
- Tutorial-style comments on straightforward logic
- Generic phrases like “This function handles...”, “Here we...”, “Basically...”, “It is important to note...”, or “In order to...”
- Vague comments that do not capture the real constraint
- Outdated or misleading comments
- Temporary TODO/FIXME comments unless the user explicitly wants them kept

Output:

1. Apply the changes directly.
2. Report which files were changed and the types of comment fixes made.
3. Mention any comments intentionally left unchanged because of skills, tooling, framework rules, or lack of a clearly better rewrite.
4. If no meaningful changes were needed, say exactly: `No meaningful comment changes needed.`

Constraints:

- Keep changes scoped to comment quality.
- Do not expand diff-scoped cleanup into full-file cleanup unless the user explicitly asks for it.
- Only mention code simplification when it directly removes the need for the comment.
