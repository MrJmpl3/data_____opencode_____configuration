import type { SubagentState } from '../domain/types.ts';
import type { PersistedSnapshotArtifacts } from '../shared/persisted-artifacts.ts';

import { DEFAULT_SUBAGENT_VISIBILITY_POLICY, type SubagentVisibilityPolicy } from '../shared/visibility.ts';
import { buildTuiSnapshot, type TuiSnapshot } from './snapshot.ts';

export type SnapshotPersistenceSource = 'startup' | 'event' | 'load' | 'refresh';

export type PersistSnapshotMeta = {
  source: SnapshotPersistenceSource;
  lastEventType?: string;
  bufferedEventCount?: number;
};

const serializeDebugSnapshot = (state: SubagentState, snapshot: TuiSnapshot, meta: PersistSnapshotMeta): string => {
  return JSON.stringify(
    {
      persistedAt: new Date().toISOString(),
      source: meta.source,
      lastEventType: meta.lastEventType,
      bufferedEventCount: meta.bufferedEventCount ?? 0,
      stateUpdatedAt: state.updatedAt,
      totalExecuted: state.totalExecuted,
      ...snapshot.debug,
    },
    null,
    2,
  );
};

export const formatPersistedSnapshot = (
  state: SubagentState,
  meta: PersistSnapshotMeta,
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): PersistedSnapshotArtifacts => {
  const snapshot = buildTuiSnapshot(state, Date.now(), visibilityPolicy);

  return {
    statusText: snapshot.statusSnapshotLine,
    debugSnapshot: serializeDebugSnapshot(state, snapshot, meta),
  };
};
