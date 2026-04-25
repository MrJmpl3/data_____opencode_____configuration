---
description: Add short educational comments to files
---

Objective: add or refine educational comments in a single target file, or the smallest sensible set of files in one target directory, using the `documentation-comments-educational` skill and its configuration parameters.

Arguments:

- `$ARGUMENTS` can be a file path, a directory path, or a natural-language request describing what should be commented.
- Treat clear inline directives in `$ARGUMENTS` as skill parameters when they map to: `Comment Detail`, `Repetitiveness`, `User Knowledge`, `Educational Level`, `Tone`, `Focus Areas`, `Improvement Suggestions`, `Line Number Referencing`, `Nest Comments`, `Max Comment Density`, `Add Metadata Header`, `Section Labels`, `File Summary`, and `Warn Comments`.

Steps:

1) If `$ARGUMENTS` is empty, stop immediately and report:
   "Please provide a target file or directory path. Example: `/comment-educational path/to/file`"
2) Inspect whether `$ARGUMENTS` points to a file, a directory, or a request.
3) Before changing anything, load and follow the `documentation-comments-educational` skill.
4) Build the skill configuration from the request and the defaults:
   - `File Name`: the resolved target path or paths
   - `Comment Detail`: default to `1`, raise it only when the file is dense or the request asks for deeper teaching
   - `Repetitiveness`: default to `1`, raise it only when the file needs more guidance
   - `User Knowledge`: infer from the file type and the request
   - `Educational Level`: infer from the stack or framework
   - `Tone`: use concise conversational Spanish unless the request says otherwise
   - `Section Labels`: keep them off unless they clearly improve navigation
   - `File Summary`: keep it off unless the request explicitly wants an overview
   - `Warn Comments`: keep them off unless a risk is genuinely non-obvious
   - `Improvement Suggestions`: keep them off unless explicitly requested
   - `Add Metadata Header`: keep it off
5) If it is a request:
   - infer the most likely target file or directory from the text and the repo context.
   - if the target is ambiguous, ask one brief clarifying question before editing.
   - if the request clearly maps to a file or directory, continue with the same rules as a path-based invocation.
6) If it is a file:
   - Read the target file completely.
   - Identify the file type, its logical sections, and which skill parameters matter most for that file.
7) If it is a directory:
   - Inspect the directory first and identify which files are good candidates for educational comments.
   - Prioritize files where comments can clarify intent, structure, trade-offs, or non-obvious behavior.
   - Skip generated files, vendored code, dependencies, build artifacts, lockfiles, binaries, and files where comments would add little value.
   - Apply the smallest sensible scope: edit only the files that clearly benefit from educational comments instead of touching everything in the directory.
   - Read each selected file completely before editing it.
   - Work file by file and keep the style consistent across all edited files.
8) Add or refine comments following these rules:
   - Keep the existing behavior unchanged.
   - Use educational comments only where they clarify intent, trade-offs, or non-obvious behavior.
   - Use a natural, concise Spanish tone.
   - Keep comments technically precise, short, and low-noise.
   - Prefer explaining why over obvious mechanics.
   - Improve existing comments instead of stacking duplicates.
   - Use section labels only when they genuinely help navigation.
   - Do not flood the file with comments.
9) Match this comment style:
   - direct
   - friendly but professional
   - technically grounded
   - not casual or slang-heavy
   - adapted to the language or file type being edited
10) Preserve each edited file's formatting, indentation, and syntax.
11) After editing, re-read every edited file and verify:
   - comments feel consistent from top to bottom
   - no comment merely restates obvious code
   - no syntax or formatting was broken
12) Return a short summary of:
   - which file or files were edited
   - what sections were commented or refined
   - which files were intentionally skipped when the target was a directory, if that context helps explain the scope

Constraints:

- Do not change runtime behavior.
- Do not rename symbols unless explicitly requested.
- Do not add placeholder comments or TODOs.
- Do not add metadata headers.
- Do not rewrite the whole file just to add comments.
- Do not force the same comment density in every language; adapt to the file.
- Do not edit every file in a directory by default; prefer the smallest useful subset.
- Do not touch generated or third-party files just to make the directory look uniformly commented.

## Desired comment style examples

- "Este bloque concentra la configuracion comun para que los cambios del entorno queden fuera de la base."
- "Aqui no alcanza con ver el nombre de la funcion; el comentario aclara por que se hace asi y que problema evita."
- "En este punto conviene priorizar legibilidad, porque el comportamiento depende mas del orden que de la complejidad del codigo."
