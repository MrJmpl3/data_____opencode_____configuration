import { describe, expect, it } from 'vitest';

import { DEFAULT_STALE_RUNNING_PROBE_POLICY, resolveSubagentStatusPluginOptions } from '../src/runtime/options.ts';

describe('subagent status options', () => {
  it('returns defaults when plugin options are omitted', () => {
    expect(resolveSubagentStatusPluginOptions(undefined)).toEqual({
      staleRunningProbePolicy: DEFAULT_STALE_RUNNING_PROBE_POLICY,
      persistence: {
        statePath: undefined,
        preserveStateOnStartup: false,
      },
      recovery: {
        sqliteDatabasePath: undefined,
      },
    });
  });

  it('normalizes explicit plugin options without relying on environment variables', () => {
    expect(
      resolveSubagentStatusPluginOptions({
        staleRunningProbePolicy: {
          baseBackoffMs: 500,
          maxBackoffMs: 200,
          maxAttempts: -3,
          refreshIntervalMs: 0,
        },
        persistence: {
          statePath: ' /tmp/subagent-status.json ',
          preserveStateOnStartup: true,
        },
        recovery: {
          sqliteDatabasePath: '/tmp/opencode.db',
        },
      }),
    ).toEqual({
      staleRunningProbePolicy: {
        baseBackoffMs: 1_000,
        maxBackoffMs: 1_000,
        maxAttempts: 0,
        refreshIntervalMs: 1_000,
      },
      persistence: {
        statePath: '/tmp/subagent-status.json',
        preserveStateOnStartup: true,
      },
      recovery: {
        sqliteDatabasePath: '/tmp/opencode.db',
      },
    });
  });
});
