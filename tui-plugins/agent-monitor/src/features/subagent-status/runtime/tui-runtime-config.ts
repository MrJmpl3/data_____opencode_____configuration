import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { createBufferedTaskQueue } from './queue.ts';
import type { ResolvedSubagentStatusPluginOptions } from './options.ts';
import { createPersistQueue, resolveStatePath } from '../infrastructure/persistence.ts';
import { resolveTextPath } from '../infrastructure/persistence/io.ts';
import { createSQLiteRecoverySource } from '../infrastructure/sqlite/hydrate.ts';
import { formatPersistedSnapshot, type PersistSnapshotMeta } from './snapshot.ts';
import type { RecoverySource } from '../infrastructure/recovery.ts';
import type { StaleRunningProbePolicy } from './options.ts';
import type { SubagentState } from '../domain/types.ts';

type BufferedEventHandler = (event: unknown) => Promise<void>;

// Bundle of values derived from the resolved options + plugin API. The runtime
// orchestrator reads these instead of recomputing paths or wiring up the
// persist queue, keeping createTuiRuntime focused on lifecycle wiring.
export type TuiRuntimeConfig = {
  statePath: string;
  textPath: string;
  persistQueuedSnapshot: (state: SubagentState, meta: PersistSnapshotMeta) => Promise<void>;
  recoverySources: RecoverySource[];
  staleRunningProbePolicy: StaleRunningProbePolicy;
  bufferedEvents: BufferedEventQueue;
};

export type BufferedEventQueue = {
  push: (event: unknown) => void;
  markReady: () => Promise<void>;
  wasTruncated: () => boolean;
  size: () => number;
};

// Pure builder. It does not capture closure-scoped state from the runtime —
// the `eventHandler` callback is supplied by the orchestrator so this module
// stays free of cross-dependencies.
export const buildTuiRuntimeConfig = (
  api: TuiPluginApi,
  options: ResolvedSubagentStatusPluginOptions,
  eventHandler: BufferedEventHandler,
): TuiRuntimeConfig => {
  const statePath = resolveStatePath({
    workspaceDirectory: api.state.path.directory,
    statePath: options.persistence.statePath,
  });
  const textPath = resolveTextPath(statePath);
  const visibilityPolicy = options.visibility;
  const persistQueuedSnapshot = createPersistQueue(statePath, textPath, (state, meta: PersistSnapshotMeta) =>
    formatPersistedSnapshot(state, meta, visibilityPolicy),
  );
  const recoverySources: RecoverySource[] = options.recovery.sqliteDatabasePath
    ? [
        createSQLiteRecoverySource({
          databasePath: options.recovery.sqliteDatabasePath,
          hardStaleAfterMs: options.staleRunningProbePolicy.hardStaleAfterMs,
        }),
      ]
    : [];
  const bufferedEvents = createBufferedTaskQueue(eventHandler);

  return {
    statePath,
    textPath,
    persistQueuedSnapshot,
    recoverySources,
    staleRunningProbePolicy: options.staleRunningProbePolicy,
    bufferedEvents,
  };
};
