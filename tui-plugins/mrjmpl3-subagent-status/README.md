# mrjmpl3-subagent-status

TUI plugin for OpenCode that tracks subagent work in the sidebar and home footer.

## What it does

- renders running, done, and errored subagent rows
- persists a lightweight sidebar snapshot for external consumers
- reconciles live session children with best-effort recovery data
- backfills token usage for completed sessions when that data arrives late

## Install

Add the plugin to your OpenCode TUI config with either a bare path or a tuple with options.

```json
{
  "plugin": [
    [
      "/absolute/path/to/tui-plugins/mrjmpl3-subagent-status",
      {
        "persistence": {
          "statePath": "/tmp/subagent-status/state.json",
          "preserveStateOnStartup": true
        },
        "recovery": {
          "sqliteDatabasePath": "/path/to/opencode.db"
        },
        "staleRunningProbePolicy": {
          "refreshIntervalMs": 60000
        },
        "visibility": {
          "doneRetentionMs": 600000,
          "staleRetentionMs": 1200000
        }
      }
    ]
  ]
}
```

## Options

### `persistence`

- `statePath`: explicit snapshot path
- `preserveStateOnStartup`: load the last persisted snapshot on boot

### `recovery`

- `sqliteDatabasePath`: explicit OpenCode SQLite database path for best-effort recovery hydration

### `staleRunningProbePolicy`

- `baseBackoffMs`
- `maxBackoffMs`
- `maxAttempts`
- `refreshIntervalMs`

### `visibility`

- `doneRetentionMs`: how long a `done` row stays visible before it ages out
- `staleRetentionMs`: how long a zombie/stale row stays visible before it ages out

## Development

```bash
npm install
npm run format
npm test
npm run typecheck
```

The package follows the repository-level Prettier config automatically.
