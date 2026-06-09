# mrjmpl3-rtk

OpenCode plugin that rewrites shell commands through `rtk rewrite` to reduce token usage.

## What it does

- checks for `rtk` in `PATH` during plugin startup
- disables itself with a warning when `rtk` is unavailable
- rewrites `bash` and `shell` tool commands with `rtk rewrite`
- leaves commands unchanged when rewriting fails or returns an empty result

## Install

To load this plugin from OpenCode config, point at the prefixed entrypoint:

```json
{
  "plugin": ["/absolute/path/to/plugins/mrjmpl3-rtk.ts"]
}
```

## Exports

- `RtkOpenCodePlugin`
- `default`

## Development

```bash
npm install
npm run format
npm test
npm run typecheck
```

Restart OpenCode after changing plugin files so the config-time module is reloaded.
