# mrjmpl3-background-agents

OpenCode plugin that provides persistent, asynchronous background delegation tools.

## What it does

- registers `delegate`, `delegation_read`, and `delegation_list` tools
- runs delegated agents in isolated background sessions
- persists delegation results to local markdown files
- injects delegation usage rules and compaction recovery context
- refreshes the local skill registry once per plugin lifecycle

## Install

To load this plugin from OpenCode config, point at the prefixed entrypoint:

```json
{
  "plugin": ["/absolute/path/to/plugins/mrjmpl3-background-agents.ts"]
}
```

## Exports

- `BackgroundAgents`
- `default`
- `OpencodeClient` type

## Development

```bash
npm install
npm run format
npm test
npm run typecheck
```

Restart OpenCode after changing plugin files so the config-time module is reloaded.
