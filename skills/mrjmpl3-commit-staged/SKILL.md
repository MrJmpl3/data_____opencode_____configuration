---
name: mrjmpl3-commit-staged
description:
  'Trigger: commit staged, staged commit, commit staged changes, git commit, validar cambios staged.
  Validate staged changes, check for whitespace errors and conflict markers, and create a conventional
  commit with a generated message.'
license: Apache-2.0
metadata:
  author: mrjmpl3
  version: '1.0'
---

## When to Use

Use this skill when you need to create a commit from staged files with proper validation and a
conventional commit message. It should only be activated for staged changes — not for unstaged work
or amending commits.

## Critical Rules

| Rule                                    | Explanation                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Stop on empty staged                    | If nothing is staged, report and stop — do not commit.                             |
| Stop on whitespace/conflict errors      | Run `diff --cached --check`. If it reports errors, show output and stop.           |
| No unstaged files                       | Only commit what is staged — never `git add` extra files.                          |
| No amend                                | Never use `--amend`. Create a new commit.                                          |
| Must confirm commit success             | Run `git status` after committing to verify.                                       |

## Execution Steps

1. Run `git diff --cached --name-only` to list staged files.
2. If the output is empty, stop immediately and report: "No staged files found. Stage files with
   `git add` first."
3. Run `git diff --cached --check` to catch whitespace errors and conflict markers.
4. If `git diff --cached --check` reports any problems, stop immediately and report the exact output.
   Do not commit.
5. Run `git diff --cached` to read the full diff of staged changes.
6. Generate a commit message following these rules:
   - Format: `<emoji> <type>(<scope>): <description>`
   - Gitmoji: use real Unicode emoji (e.g. ✨), never shortcode (e.g. `:sparkles:`)
   - Language: description in Spanish, entirely lowercase, max 100 characters
   - Content: prefer the "why" when supported by the diff or nearby context; otherwise use a
     conservative description of the change without inventing motivation
   - Scope: use the smallest meaningful scope from the staged files; if the change spans multiple
     areas, use the app/package/service name
   - Use the generated message directly in `git commit -m "<message>"`
7. Run `git commit -m "<message>"`.
8. If `git commit` fails, report the failure output and stop.
9. Run `git status` to confirm the commit was successful.
10. Report whether the commit succeeded and include the exact commit message used.

## Valid Commit Message Examples

```
✨ feat(factura): agregar validacion de montos negativos
🐛 fix(tenant): corregir aislamiento de cache en jobs
♻️ refactor(auth): extraer logica de tokens a servicio dedicado
```

## Commands

```bash
# List staged files
git diff --cached --name-only

# Check for whitespace errors and conflict markers
git diff --cached --check

# View full staged diff
git diff --cached

# Create the commit (message generated from diff analysis)
git commit -m "✨ feat(scope): descripcion del cambio"

# Verify commit was created
git status
```
