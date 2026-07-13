import { isRecord } from '../../../kit/coercion.ts';
import {
  DEFAULT_DONE_RETENTION_MS,
  DEFAULT_STALE_RETENTION_MS,
  DEFAULT_SUBAGENT_VISIBILITY_POLICY,
  type SubagentVisibilityPolicy,
} from '../shared/display.ts';

export type StaleRunningProbePolicy = {
  baseBackoffMs: number;
  hardStaleAfterMs: number;
  inactiveThresholdMs: number;
  maxBackoffMs: number;
  maxAttempts: number;
  refreshIntervalMs: number;
};

export interface SubagentStatusStaleRunningProbePolicyOptions {
  /**
   * Base backoff for probing a session that still appears as running. Invalid
   * values are replaced by the safe minimum.
   */
  baseBackoffMs?: number;
  hardStaleAfterMs?: number;
  /**
   * How long a running session can go without new activity (any event that
   * updates the child) before the stale-probe marks it as error when there is
   * no running evidence from messages. Default 10 minutes.
   * 0 disables this check.
   */
  inactiveThresholdMs?: number;
  /**
   * Exponential backoff ceiling so abandoned probes do not run forever while
   * still avoiding excessive pressure on sessions that have not emitted
   * terminal evidence yet.
   */
  maxBackoffMs?: number;
  /**
   * Maximum extra probes before waiting for new visible session activity.
   */
  maxAttempts?: number;
  /**
   * Reconciliation loop interval used to decide whether running-session probes
   * should run.
   */
  refreshIntervalMs?: number;
}

export interface SubagentStatusPersistenceOptions {
  /**
   * Explicit persisted snapshot path. This lets `tui.json` choose the file
   * instead of relying on external conventions or environment variables.
   */
  statePath?: string;
  /**
   * When true, the runtime attempts to load the last snapshot on startup.
   * When false or omitted, it starts from an empty state.
   */
  preserveStateOnStartup?: boolean;
}

export interface SubagentStatusRecoveryOptions {
  /**
   * Explicit OpenCode SQLite database path used for recovery. The plugin does
   * not read plugin-specific configuration from environment variables; this
   * `options` object is the supported input boundary.
   */
  sqliteDatabasePath?: string;
}

export interface SubagentStatusVisibilityOptions {
  doneRetentionMs?: number;
  /**
   * How long a legacy `stale` child remains eligible for visibility. Current
   * abandoned-session detection marks rows as `error` instead.
   */
  staleRetentionMs?: number;
}

/**
 * Public shape of the `options` object that accompanies this plugin in
 * `tui.json`.
 *
 * Ejemplo de la entrada completa:
 * `[
 *   "/abs/path/to/agent-monitor",
 *   {
 *     staleRunningProbePolicy: { refreshIntervalMs: 120000 },
 *     visibility: { staleRetentionMs: 1800000 },
 *     persistence: { statePath: "/tmp/subagent-status.json" },
 *     recovery: { sqliteDatabasePath: "/tmp/opencode.db" }
 *   }
 * ]`
 *
 * OpenCode passes that second tuple element as `options: unknown`, so this
 * module defines the expected shape and normalizes it at a single boundary.
 * Environment variables are not a supported plugin-specific configuration
 * path.
 */
export interface SubagentStatusPluginOptions {
  staleRunningProbePolicy?: SubagentStatusStaleRunningProbePolicyOptions;
  visibility?: SubagentStatusVisibilityOptions;
  persistence?: SubagentStatusPersistenceOptions;
  recovery?: SubagentStatusRecoveryOptions;
  debug?: boolean;
}

/**
 * Helper alias for typing a complete `plugin` array entry in `tui.json`: the
 * first element is the plugin spec/path, and the second is the options object
 * normalized by this module.
 */
export type SubagentStatusPluginConfigEntry = readonly [pluginSpec: string, options: SubagentStatusPluginOptions];

export interface ResolvedSubagentStatusPluginOptions {
  staleRunningProbePolicy: StaleRunningProbePolicy;
  visibility: SubagentVisibilityPolicy;
  persistence: {
    statePath?: string;
    preserveStateOnStartup: boolean;
  };
  recovery: {
    sqliteDatabasePath?: string;
  };
  debug: boolean;
}

export const DEFAULT_STALE_RUNNING_PROBE_POLICY: StaleRunningProbePolicy = {
  baseBackoffMs: 60_000,
  hardStaleAfterMs: 5 * 60 * 60_000,
  inactiveThresholdMs: 10 * 60_000,
  maxBackoffMs: 5 * 60_000,
  maxAttempts: 4,
  refreshIntervalMs: 60_000,
};

export { DEFAULT_DONE_RETENTION_MS, DEFAULT_STALE_RETENTION_MS };

const MIN_BACKOFF_MS = 1_000;
const MIN_REFRESH_INTERVAL_MS = 1_000;
const MAX_MAX_ATTEMPTS = 100;

const stringOption = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const numberOption = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const integerOption = (value: unknown): number | undefined => {
  const parsed = numberOption(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
};

// Clamp a user-supplied numeric option to a safe range, falling back when
// the value is missing or not a finite number. `floor: true` truncates to an
// integer; `max` is an optional upper bound used for `maxAttempts`.
const clampOption = (
  value: unknown,
  fallback: number,
  minimum: number,
  options: { floor?: boolean; max?: number } = {},
): number => {
  const parsed = options.floor ? integerOption(value) : numberOption(value);
  const resolved = parsed ?? fallback;
  const floored = options.floor ? Math.floor(resolved) : resolved;
  const lower = Math.max(minimum, floored);
  return options.max === undefined ? lower : Math.min(options.max, lower);
};

/**
 * Normalizes the raw payload received from `plugin: [[spec, options]]`.
 * Keeping this conversion in one place prevents the runtime from guessing at
 * partial shapes or reintroducing environment-variable configuration.
 */
export const normalizeSubagentStatusPluginOptions = (options: unknown): ResolvedSubagentStatusPluginOptions => {
  const pluginOptions = isRecord(options) ? options : {};
  const staleRunningProbePolicy = isRecord(pluginOptions.staleRunningProbePolicy)
    ? pluginOptions.staleRunningProbePolicy
    : {};
  const visibility = isRecord(pluginOptions.visibility) ? pluginOptions.visibility : {};
  const persistence = isRecord(pluginOptions.persistence) ? pluginOptions.persistence : {};
  const recovery = isRecord(pluginOptions.recovery) ? pluginOptions.recovery : {};

  const baseBackoffMs = clampOption(
    staleRunningProbePolicy.baseBackoffMs,
    DEFAULT_STALE_RUNNING_PROBE_POLICY.baseBackoffMs,
    MIN_BACKOFF_MS,
  );
  const maxBackoffMs = Math.max(
    baseBackoffMs,
    clampOption(staleRunningProbePolicy.maxBackoffMs, DEFAULT_STALE_RUNNING_PROBE_POLICY.maxBackoffMs, baseBackoffMs),
  );
  const maxAttempts = clampOption(
    staleRunningProbePolicy.maxAttempts,
    DEFAULT_STALE_RUNNING_PROBE_POLICY.maxAttempts,
    0,
    { floor: true, max: MAX_MAX_ATTEMPTS },
  );
  const hardStaleAfterMs = clampOption(
    staleRunningProbePolicy.hardStaleAfterMs,
    DEFAULT_STALE_RUNNING_PROBE_POLICY.hardStaleAfterMs,
    0,
    { floor: true },
  );
  const inactiveThresholdMs = clampOption(
    staleRunningProbePolicy.inactiveThresholdMs,
    DEFAULT_STALE_RUNNING_PROBE_POLICY.inactiveThresholdMs,
    0,
    { floor: true },
  );
  const refreshIntervalMs = clampOption(
    staleRunningProbePolicy.refreshIntervalMs,
    DEFAULT_STALE_RUNNING_PROBE_POLICY.refreshIntervalMs,
    MIN_REFRESH_INTERVAL_MS,
  );
  const staleRetentionMs = clampOption(visibility.staleRetentionMs, DEFAULT_STALE_RETENTION_MS, 0, { floor: true });
  const doneRetentionMs = clampOption(visibility.doneRetentionMs, DEFAULT_DONE_RETENTION_MS, 0, { floor: true });

  return {
    staleRunningProbePolicy: {
      baseBackoffMs,
      hardStaleAfterMs,
      inactiveThresholdMs,
      maxBackoffMs,
      maxAttempts,
      refreshIntervalMs,
    },
    visibility: {
      ...DEFAULT_SUBAGENT_VISIBILITY_POLICY,
      doneRetentionMs,
      staleRetentionMs,
    },
    persistence: {
      statePath: stringOption(persistence.statePath),
      preserveStateOnStartup: persistence.preserveStateOnStartup === true,
    },
    recovery: {
      sqliteDatabasePath: stringOption(recovery.sqliteDatabasePath),
    },
    debug: pluginOptions.debug === true,
  };
};

export const resolveSubagentStatusPluginOptions = normalizeSubagentStatusPluginOptions;
