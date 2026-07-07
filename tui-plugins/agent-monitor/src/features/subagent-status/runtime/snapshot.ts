import type { SubagentChild, SubagentCounts, SubagentState } from '../domain/types.ts';

import { resolveElapsedMs } from '../domain/state/core.ts';
import { DEFAULT_SUBAGENT_VISIBILITY_POLICY, type SubagentVisibilityPolicy } from '../shared/display.ts';
import type { PersistedSnapshotArtifacts } from '../shared/display.ts';
import { statusColor as resolveRenderStatusColor } from '../ui/format.ts';
import { buildSubagentSnapshotView, renderStatusLine, renderStatusSnapshotLine } from '../ui/view-model.ts';

export interface TuiSnapshot {
  counts: SubagentCounts;
  visibleCounts: SubagentCounts;
  statusLine: string;
  statusSnapshotLine: string;
  visibleChildren: SubagentChild[];
  debug: {
    snapshotSemantics: 'snapshot';
    trackedChildren: number;
    visibleChildren: number;
    hiddenChildren: number;
    trackedCounts: SubagentCounts;
    visibleCounts: SubagentCounts;
  };
}

export const hydrateSnapshotChild = (child: SubagentChild, nowMs: number): SubagentChild => {
  return {
    ...child,
    color: child.color ?? resolveRenderStatusColor(child.status),
    elapsedMs: resolveElapsedMs(child, nowMs),
  };
};

export const buildTuiSnapshot = (
  state: SubagentState,
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): TuiSnapshot => {
  const hydratedChildren = Object.values(state.children).map((child) => hydrateSnapshotChild(child, nowMs));
  const snapshotView = buildSubagentSnapshotView(hydratedChildren, nowMs, visibilityPolicy);

  return {
    counts: snapshotView.trackedCounts,
    visibleCounts: snapshotView.visibleCounts,
    statusLine: renderStatusLine(state, nowMs, visibilityPolicy),
    statusSnapshotLine: renderStatusSnapshotLine(state, nowMs, visibilityPolicy),
    visibleChildren: snapshotView.visibleChildren,
    debug: {
      snapshotSemantics: 'snapshot',
      trackedChildren: snapshotView.trackedChildren.length,
      visibleChildren: snapshotView.visibleChildren.length,
      hiddenChildren: Math.max(0, snapshotView.trackedChildren.length - snapshotView.visibleChildren.length),
      trackedCounts: snapshotView.trackedCounts,
      visibleCounts: snapshotView.visibleCounts,
    },
  };
};

// ---------------------------------------------------------------------------
// persisted-snapshot.ts
// ---------------------------------------------------------------------------

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
