import type { SubagentChild } from '../domain/types.ts';

import { sameDisplayText } from '../shared/display.ts';
import { DEFAULT_SUBAGENT_VISIBILITY_POLICY, type SubagentVisibilityPolicy } from '../shared/display.ts';

const normalizeWorkItemTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const relatedWorkItemTitles = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeWorkItemTitle(left);
  const normalizedRight = normalizeWorkItemTitle(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
};

const sameAgentName = (left: string | undefined, right: string | undefined): boolean => {
  if (!left || !right) return true;
  return normalizeWorkItemTitle(left) === normalizeWorkItemTitle(right);
};

const isGenericToolWrapper = (child: SubagentChild): boolean => {
  if (child.source !== 'tool') return false;
  const title = normalizeWorkItemTitle(child.title);
  return title === 'delegate' || title === 'task';
};

const sessionMatchesSynthetic = (session: SubagentChild, synthetic: SubagentChild): boolean => {
  if (session.source !== 'session' && !session.id.startsWith('ses_')) return false;
  if (session.parentID !== synthetic.parentID) return false;
  if (synthetic.targetSessionID === session.id) return true;
  if (session.targetSessionID === synthetic.id) return true;
  if (synthetic.messageID && session.messageID && synthetic.messageID === session.messageID) return true;
  if (isGenericToolWrapper(synthetic)) return false;
  return sameAgentName(session.agentName, synthetic.agentName) && relatedWorkItemTitles(session.title, synthetic.title);
};

const betterPriority = (current: SubagentChild | undefined, candidate: SubagentChild): SubagentChild => {
  if (!current) return candidate;
  return byPriority(candidate, current) < 0 ? candidate : current;
};

const mergeSyntheticWithSession = (synthetic: SubagentChild, session: SubagentChild | undefined): SubagentChild => {
  if (!session) return synthetic;
  return {
    ...synthetic,
    status: session.status,
    color: session.color,
    startedAt: session.startedAt ?? synthetic.startedAt,
    updatedAt: session.updatedAt ?? synthetic.updatedAt,
    endedAt: session.endedAt ?? synthetic.endedAt,
    elapsedMs: session.elapsedMs ?? synthetic.elapsedMs,
    tokens: session.tokens ?? synthetic.tokens,
    targetSessionID: session.id,
    agentName: synthetic.agentName ?? session.agentName,
  };
};

export const byPriority = (left: SubagentChild, right: SubagentChild): number => {
  const startedDiff = right.startedAt.localeCompare(left.startedAt);
  if (startedDiff !== 0) return startedDiff;
  return left.id.localeCompare(right.id);
};

export const formatAggregateNumber = (value: number): string => Math.max(0, Math.round(value)).toLocaleString('en-US');

const groupSyntheticByParent = (children: SubagentChild[]) => {
  const syntheticChildren: SubagentChild[] = [];
  const syntheticByParentID = new Map<string, SubagentChild[]>();
  const sessionCandidatesByParentID = new Map<string, SubagentChild[]>();

  for (const child of children) {
    const isSynthetic = child.source === 'tool' || child.source === 'subtask';
    if (isSynthetic) {
      syntheticChildren.push(child);
      const siblings = syntheticByParentID.get(child.parentID);
      if (siblings) siblings.push(child);
      else syntheticByParentID.set(child.parentID, [child]);
    }
    if (child.source === 'session' || child.id.startsWith('ses_')) {
      const candidates = sessionCandidatesByParentID.get(child.parentID);
      if (candidates) candidates.push(child);
      else sessionCandidatesByParentID.set(child.parentID, [child]);
    }
  }

  return { syntheticChildren, syntheticByParentID, sessionCandidatesByParentID };
};

const matchSyntheticToSession = (
  syntheticChildren: SubagentChild[],
  sessionCandidatesByParentID: Map<string, SubagentChild[]>,
) => {
  const sessionBySyntheticID = new Map<string, SubagentChild>();
  const hiddenMatchedSessionIDs = new Set<string>();

  for (const synthetic of syntheticChildren) {
    let bestSession: SubagentChild | undefined;
    const sessionCandidates = sessionCandidatesByParentID.get(synthetic.parentID) ?? [];
    for (const candidate of sessionCandidates) {
      if (!sessionMatchesSynthetic(candidate, synthetic)) continue;
      bestSession = betterPriority(bestSession, candidate);
    }
    if (bestSession) {
      sessionBySyntheticID.set(synthetic.id, bestSession);
      if (bestSession.source === 'session') hiddenMatchedSessionIDs.add(bestSession.id);
    }
  }

  return { sessionBySyntheticID, hiddenMatchedSessionIDs };
};

const deduplicateSyntheticTools = (syntheticByParentID: Map<string, SubagentChild[]>): Set<string> => {
  const hiddenSyntheticToolIDs = new Set<string>();
  for (const siblings of syntheticByParentID.values()) {
    for (const child of siblings) {
      if (child.source !== 'tool') continue;
      if (isGenericToolWrapper(child)) {
        if (siblings.length > 1) hiddenSyntheticToolIDs.add(child.id);
        continue;
      }
      for (const sibling of siblings) {
        if (sibling.id === child.id) continue;
        if (relatedWorkItemTitles(sibling.title, child.title) || sameDisplayText(sibling.summary, child.summary)) {
          hiddenSyntheticToolIDs.add(child.id);
          break;
        }
      }
    }
  }

  return hiddenSyntheticToolIDs;
};

export const collapseSubagentWorkItems = (children: SubagentChild[]): SubagentChild[] => {
  const { syntheticChildren, syntheticByParentID, sessionCandidatesByParentID } = groupSyntheticByParent(children);
  const { sessionBySyntheticID, hiddenMatchedSessionIDs } = matchSyntheticToSession(
    syntheticChildren,
    sessionCandidatesByParentID,
  );
  const hiddenSyntheticToolIDs = deduplicateSyntheticTools(syntheticByParentID);

  return children
    .filter((child) => {
      if (child.source === 'session') return !hiddenMatchedSessionIDs.has(child.id);
      if (child.source !== 'tool') return true;
      return !hiddenSyntheticToolIDs.has(child.id);
    })
    .map((child) => mergeSyntheticWithSession(child, sessionBySyntheticID.get(child.id)));
};

export const isVisibleWorkItem = (
  child: SubagentChild,
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): boolean => {
  if (child.status === 'running' || child.status === 'error' || child.status === 'stale') return true;
  const endedMs = Date.parse(child.endedAt ?? child.updatedAt);
  if (Number.isNaN(endedMs)) return false;
  return nowMs - endedMs <= visibilityPolicy.doneRetentionMs;
};

export const visibleSubagentWorkItems = (
  children: SubagentChild[],
  nowMs = Date.now(),
  visibilityPolicy: SubagentVisibilityPolicy = DEFAULT_SUBAGENT_VISIBILITY_POLICY,
): SubagentChild[] => {
  const visible = collapseSubagentWorkItems(children).filter((child) =>
    isVisibleWorkItem(child, nowMs, visibilityPolicy),
  );
  const hasRunning = visible.some((child) => child.status === 'running');
  const activeMessageIDs = new Set(
    visible.flatMap((child) => (child.status === 'running' && child.messageID ? [child.messageID] : [])),
  );
  if (!hasRunning) return visible;
  return visible.filter((child) => {
    if (child.status === 'running' || child.status === 'error' || child.status === 'stale') return true;
    if (!child.messageID) return false;
    return activeMessageIDs.has(child.messageID);
  });
};
