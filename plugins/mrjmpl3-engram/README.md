# mrjmpl3-engram

OpenCode plugin adapter for the local Engram memory server.

## What it does

- starts `engram serve` when the local HTTP server is not running
- captures user prompts and top-level session activity
- suppresses sub-agent sessions to avoid session inflation
- injects persistent memory protocol instructions into the system prompt
- adds memory context and compaction persistence instructions during compaction

## Install

To load this plugin from OpenCode config, point at the prefixed entrypoint:

```json
{
  "plugin": ["/absolute/path/to/plugins/mrjmpl3-engram.ts"]
}
```

## Exports

- `Engram`
- `default`

## Development

```bash
npm install
npm run format
npm test
npm run typecheck
```

Restart OpenCode after changing plugin files so the config-time module is reloaded.
