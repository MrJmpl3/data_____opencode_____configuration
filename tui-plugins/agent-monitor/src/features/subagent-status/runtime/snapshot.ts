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

/**
 * Structural subset of TuiSnapshot that does NOT depend on per-tick timing.
 * Children are NOT hydrated (no elapsedMs) — use `buildTimedSnapshot` to
 * produce the final `TuiSnapshot` with hydrated elapsed times.
 */
export interface TuiStructuralView {
  trackedChildren: SubagentChild[];
  visibleChildren: SubagentChild[];
  trackedCounts: SubagentCounts;
  visibleCounts: SubagentCounts;
  statusLine: string;
  statusSnapshotLine: string;
}

export const hydrateSnapshotChild = (child: SubagentChild, nowMs: number): SubagentChild => {
  return {
    ...child,
    color: child.color ?? resolveRenderStatusColor(child.status),
    elapsedMs: resolveElapsedMs(child, nowMs),
  };
};

/**
 * Builds the structural snapshot view — sorts, collapses, filters, and counts
 * children. Only recomputes when the state tree changes, NOT on every clock
 * tick. The `nowMs` parameter is optional (defaults to Date.now()) and used
 * for done-retention filtering (10 min window, so staleness is acceptable).
 */
export const buildTuiStructuralView = (
  state: SubagentState,
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
  nowMs?: number,
): TuiStructuralView => {
  const referenceNow = nowMs ?? Date.now();
  const children = Object.values(state.children);
  const snapshotView = buildSubagentSnapshotView(children, referenceNow, visibilityPolicy);

  return {
    trackedChildren: snapshotView.trackedChildren,
    visibleChildren: snapshotView.visibleChildren,
    trackedCounts: snapshotView.trackedCounts,
    visibleCounts: snapshotView.visibleCounts,
    statusLine: renderStatusLine(state, referenceNow, visibilityPolicy),
    statusSnapshotLine: renderStatusSnapshotLine(state, referenceNow, visibilityPolicy),
  };
};

/**
 * Applies per-tick time-sensitive data (elapsedMs hydration) to a pre-computed
 * structural view. O(visibleChildren) — cheap enough to run every 1Hz tick.
 */
export const buildTimedSnapshot = (
  structural: TuiStructuralView,
  nowMs: number,
): TuiSnapshot => {
  const hydratedVisible = structural.visibleChildren.map((child) => hydrateSnapshotChild(child, nowMs));

  return {
    counts: structural.trackedCounts,
    visibleCounts: structural.visibleCounts,
    statusLine: structural.statusLine,
    statusSnapshotLine: structural.statusSnapshotLine,
    visibleChildren: hydratedVisible,
    debug: {
      snapshotSemantics: 'snapshot',
      trackedChildren: structural.trackedChildren.length,
      visibleChildren: structural.visibleChildren.length,
      hiddenChildren: Math.max(0, structural.trackedChildren.length - structural.visibleChildren.length),
      trackedCounts: structural.trackedCounts,
      visibleCounts: structural.visibleCounts,
    },
  };
};

/**
 * Full snapshot — delegates to the split version for backward compatibility.
 * Use `buildTuiStructuralView` + `buildTimedSnapshot` in hot paths.
 */
export const buildTuiSnapshot = (
  state: SubagentState,
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): TuiSnapshot => {
  return buildTimedSnapshot(buildTuiStructuralView(state, visibilityPolicy, nowMs), nowMs);
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
