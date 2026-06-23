import type { SubagentChild, SubagentCounts } from '../../domain/types.ts';

import { DEFAULT_SUBAGENT_VISIBILITY_POLICY, type SubagentVisibilityPolicy } from '../../shared/visibility.ts';
import { collapseSubagentWorkItems } from './collapse.ts';
import { byPriority } from './sort.ts';
import { visibleSubagentWorkItems } from './visibility.ts';

const countsFromChildren = (children: readonly SubagentChild[]): SubagentCounts =>
  children.reduce<SubagentCounts>(
    (counts, child) => {
      if (child.status === 'stale') {
        counts.stale += 1;
        return counts;
      }

      counts[child.status] += 1;
      return counts;
    },
    { running: 0, done: 0, stale: 0, error: 0 },
  );

export interface SubagentSnapshotView {
  trackedChildren: SubagentChild[];
  visibleChildren: SubagentChild[];
  trackedCounts: SubagentCounts;
  visibleCounts: SubagentCounts;
}

export const buildSubagentSnapshotView = (
  children: readonly SubagentChild[],
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): SubagentSnapshotView => {
  const sortedChildren = [...children].sort(byPriority);
  const collapsedChildren = collapseSubagentWorkItems(sortedChildren);
  const visibleChildren = visibleSubagentWorkItems(sortedChildren, nowMs, visibilityPolicy).sort(byPriority);

  return {
    trackedChildren: collapsedChildren,
    visibleChildren,
    trackedCounts: countsFromChildren(collapsedChildren),
    visibleCounts: countsFromChildren(visibleChildren),
  };
};
