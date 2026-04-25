# AGENTS.md

This repo is the OpenCode configuration workspace. Keep guidance short, concrete, and limited to verified repo contents.

## What’s here

- `opencode.jsonc` is the authoritative config.
- `agents/` contains concrete agent definitions.
- `commands/` contains workflow commands.
- `AGENT_TEMPLATE.md` is a scaffold, not a final agent.
- `.temp/` contains temporary WIP files for agents, skills, or commands.

## Working rules

- Prefer the smallest correct change.
- Preserve the existing OpenCode config style.
- Do not overwrite user changes in the worktree.
- Avoid adding new guidance unless it is supported by files in this repo.

## Verified config notes

- MCPs enabled here: `context7`, `gh_grep`, `github`, and `nuxt`.
- Bash/read permissions are defined in `opencode.jsonc` and should be treated as the current policy.
- `dcp.jsonc` sets context compression between 60% and 80%.
- `tui.json` sets the theme to `opencode`.

## Before editing

- Check `AGENT_TEMPLATE.md` if you are drafting or revising an agent.
- Check existing files under `agents/` and `commands/` for the local pattern.
