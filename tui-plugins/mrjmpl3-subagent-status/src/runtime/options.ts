export type StaleRunningProbePolicy = {
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxAttempts: number;
  refreshIntervalMs: number;
};

export type SubagentStatusPluginOptions = {
  staleRunningProbePolicy?: Partial<StaleRunningProbePolicy>;
  persistence?: {
    statePath?: string;
    preserveStateOnStartup?: boolean;
  };
  recovery?: {
    sqliteDatabasePath?: string;
  };
};

export type ResolvedSubagentStatusPluginOptions = {
  staleRunningProbePolicy: StaleRunningProbePolicy;
  persistence: {
    statePath?: string;
    preserveStateOnStartup: boolean;
  };
  recovery: {
    sqliteDatabasePath?: string;
  };
};

export const DEFAULT_STALE_RUNNING_PROBE_POLICY: StaleRunningProbePolicy = {
  baseBackoffMs: 60_000,
  maxBackoffMs: 5 * 60_000,
  maxAttempts: 4,
  refreshIntervalMs: 60_000,
};

const MIN_BACKOFF_MS = 1_000;
const MIN_REFRESH_INTERVAL_MS = 1_000;
const MAX_MAX_ATTEMPTS = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOption(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integerOption(value: unknown): number | undefined {
  const parsed = numberOption(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

export function resolveSubagentStatusPluginOptions(options: unknown): ResolvedSubagentStatusPluginOptions {
  const pluginOptions = isRecord(options) ? options : {};
  const staleRunningProbePolicy = isRecord(pluginOptions.staleRunningProbePolicy)
    ? pluginOptions.staleRunningProbePolicy
    : {};
  const persistence = isRecord(pluginOptions.persistence) ? pluginOptions.persistence : {};
  const recovery = isRecord(pluginOptions.recovery) ? pluginOptions.recovery : {};

  const baseBackoffMs = Math.max(
    MIN_BACKOFF_MS,
    numberOption(staleRunningProbePolicy.baseBackoffMs) ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.baseBackoffMs,
  );
  const maxBackoffMs = Math.max(
    baseBackoffMs,
    numberOption(staleRunningProbePolicy.maxBackoffMs) ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.maxBackoffMs,
  );
  const maxAttempts = Math.min(
    MAX_MAX_ATTEMPTS,
    Math.max(0, integerOption(staleRunningProbePolicy.maxAttempts) ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.maxAttempts),
  );
  const refreshIntervalMs = Math.max(
    MIN_REFRESH_INTERVAL_MS,
    numberOption(staleRunningProbePolicy.refreshIntervalMs) ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.refreshIntervalMs,
  );

  return {
    staleRunningProbePolicy: {
      baseBackoffMs,
      maxBackoffMs,
      maxAttempts,
      refreshIntervalMs,
    },
    persistence: {
      statePath: stringOption(persistence.statePath),
      preserveStateOnStartup: persistence.preserveStateOnStartup === true,
    },
    recovery: {
      sqliteDatabasePath: stringOption(recovery.sqliteDatabasePath),
    },
  };
}
