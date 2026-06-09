# mrjmpl3-model-variants

OpenCode plugin that exports provider model variant data for `gentle-ai`.

## What it does

- reads provider metadata from OpenCode's in-process SDK client
- extracts per-provider, per-model variant keys
- writes `~/.gentle-ai/cache/model-variants.json` atomically
- keeps the cache fresh even when providers stop reporting variants

## Install

To load this plugin from OpenCode config, point at the prefixed entrypoint:

```json
{
  "plugin": ["/absolute/path/to/plugins/mrjmpl3-model-variants.ts"]
}
```

## Exports

- `ModelVariantsPlugin`
- `default`

## Development

```bash
npm install
npm run format
npm test
npm run typecheck
```

Restart OpenCode after changing plugin files so the config-time module is reloaded.
