import type { SubagentChild, SubagentCounts, SubagentState } from '../domain/types.ts';

import { resolveElapsedMs } from '../domain/state.ts';
import { DEFAULT_SUBAGENT_VISIBILITY_POLICY, type SubagentVisibilityPolicy } from '../shared/visibility.ts';
import { statusColor as resolveRenderStatusColor } from '../ui/format.ts';
import { buildSubagentSnapshotView } from '../ui/view-model/snapshot-view.ts';
import { renderStatusLine, renderStatusSnapshotLine } from '../ui/view-model/status-line.ts';

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
