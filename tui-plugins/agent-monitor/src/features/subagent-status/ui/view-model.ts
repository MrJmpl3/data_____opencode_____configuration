import type { SubagentChild, SubagentCounts, SubagentState } from '../domain/types.ts';

import { DEFAULT_SUBAGENT_VISIBILITY_POLICY, type SubagentVisibilityPolicy } from '../shared/display.ts';
import { formatDuration, formatUsageCompact } from './format.ts';
import { t } from '../runtime/i18n.ts';
import { hydrateSnapshotChild } from '../runtime/snapshot.ts';
import { byPriority, collapseSubagentWorkItems, formatAggregateNumber, visibleSubagentWorkItems } from './collapse.ts';

export interface SidebarVisibleSections {
  active: SubagentChild[];
  recent: SubagentChild[];
}

export const splitSidebarVisibleSections = (children: readonly SubagentChild[]): SidebarVisibleSections =>
  children.reduce<SidebarVisibleSections>(
    (sections, child) => {
      if (child.status === 'running') sections.active.push(child);
      else sections.recent.push(child);
      return sections;
    },
    { active: [], recent: [] },
  );

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
  const collapsedChildren = collapseSubagentWorkItems([...children].sort(byPriority));
  const visibleChildren = visibleSubagentWorkItems(collapsedChildren, nowMs, visibilityPolicy).sort(byPriority);

  return {
    trackedChildren: collapsedChildren,
    visibleChildren,
    trackedCounts: countsFromChildren(collapsedChildren),
    visibleCounts: countsFromChildren(visibleChildren),
  };
};

const renderAggregate = (counts: SubagentCounts): string =>
  `${t('subagents')}: ${counts.running} ${t('run')} · ${counts.done} ${t('done')} · ${counts.error} ${t('err')}`;

const renderSnapshotAggregate = (counts: SubagentCounts): string =>
  `${t('subagents_snapshot')}: ${counts.running} ${t('run')} · ${counts.done} ${t('done')} · ${counts.error} ${t('err')}`;

const renderStatusDetails = (children: readonly SubagentChild[]): string => {
  if (children.length === 0) return '';
  return children
    .map((child) => {
      const usage = formatUsageCompact(child);
      return [child.title, formatDuration(child.elapsedMs), usage].filter((part) => part.length > 0).join(' ');
    })
    .join(' · ');
};

const buildSnapshotFromState = (
  state: SubagentState,
  nowMs: number,
  visibilityPolicy: SubagentVisibilityPolicy,
): { view: SubagentSnapshotView; details: string } => {
  const hydratedChildren = Object.values(state.children).map((child) => hydrateSnapshotChild(child, nowMs));
  const view = buildSubagentSnapshotView(hydratedChildren, nowMs, visibilityPolicy);
  const details = renderStatusDetails(view.visibleChildren);
  return { view, details };
};

export const renderStatusLine = (
  state: SubagentState,
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): string => {
  if (state.recovering) return t('syncing');
  const { view, details } = buildSnapshotFromState(state, nowMs, visibilityPolicy);
  const aggregate = `${renderAggregate(view.trackedCounts)} · Σ ${formatAggregateNumber(state.totalExecuted)}`;
  return details.length > 0 ? `${aggregate} · ${details}` : aggregate;
};

export const renderStatusSnapshotLine = (
  state: SubagentState,
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): string => {
  if (state.recovering) return t('syncing');
  const { view, details } = buildSnapshotFromState(state, nowMs, visibilityPolicy);
  const aggregate = `${renderSnapshotAggregate(view.trackedCounts)} · Σ ${formatAggregateNumber(state.totalExecuted)}`;
  return details.length > 0 ? `${aggregate} · ${details}` : aggregate;
};
