# subagent-status-observability Specification

## Purpose

Provide debug-mode logging control and a visual loading indicator for the subagent status plugin.
Debug mode lets operators enable verbose console output on demand without polluting production
stdout. The loading indicator communicates ongoing recovery operations to the user in the TUI.

## Requirements

### Requirement: Debug-mode logging is configurable via plugin options

The plugin MUST expose a `debug` boolean in `ResolvedSubagentStatusPluginOptions`. When `true`, all
`console.log` calls in the plugin SHALL execute normally. When `false` (the default), all
`console.log` calls SHALL be suppressed.

#### Scenario: Debug off suppresses all console.log

- GIVEN the plugin initializes with `debug: false` (or omitted)
- WHEN `console.log` is called anywhere in the plugin runtime
- THEN the call MUST NOT produce output

#### Scenario: Debug on enables console.log output

- GIVEN the plugin initializes with `debug: true`
- WHEN `console.log` is called
- THEN the output MUST be visible in stdout

#### Scenario: debug flag is normalized at options boundary

- GIVEN raw plugin options arrive via `tui.json`
- WHEN `normalizeSubagentStatusPluginOptions` processes them
- THEN the resolved `debug` field MUST be `true` only when the input value is strictly `true`
- AND any other value (omitted, `false`, `undefined`) MUST resolve to `false`

### Requirement: Recovery phase shows a loading indicator in the TUI

The plugin state MUST include a `recovering` boolean field. When `recovering` is `true`, the status
line or summary area MUST display a visible "⟳ syncing..." / "recovering..." indicator. When
recovery completes, the indicator MUST disappear.

#### Scenario: Loading indicator appears during recovery

- GIVEN the plugin is performing a recovery operation (SQLite recovery, snapshot load)
- WHEN `recovering` is set to `true`
- THEN the TUI MUST show a "⟳ syncing..." (or locale-equivalent) indicator
- AND the indicator MUST be visually distinct from running/done/error counts

#### Scenario: Indicator disappears after recovery completes

- GIVEN a recovery operation finishes
- WHEN `recovering` transitions from `true` to `false`
- THEN the indicator MUST disappear from the TUI
- AND the normal status line MUST be restored

#### Scenario: i18n keys exist for recovery indicator

- GIVEN the system locale is `en`
- WHEN the recovery indicator is rendered
- THEN it MUST use "⟳ syncing..." text
- GIVEN the system locale is `es`
- WHEN the recovery indicator is rendered
- THEN it MUST use localized text (e.g., "⟳ sincronizando...")
