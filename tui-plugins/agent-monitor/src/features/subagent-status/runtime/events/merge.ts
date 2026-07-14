import { cloneState } from '../../../../kit/clone.ts';
import { createSerializedTaskQueue } from '../queue.ts';
import { applySubagentEvent } from './handle.ts';
import { extractSessionId } from './extract.ts';
import type { PersistSnapshotMeta } from '../snapshot.ts';
import type { SubagentState } from '../../domain/types.ts';
import { normalizeEventPayload } from './event-payload.ts';
import { isTerminalStatus, pruneTerminalChildren } from '../../domain/state/maintenance.ts';
import { upsertRunningChild } from '../../domain/state/mutations.ts';

export type MergeEventStateInput = {
  isDisposed: () => boolean;
  getCurrentState: () => SubagentState;
  getCurrentSessionId: () => string;
  isBufferingStartupScopedEvents: () => boolean;
  bufferStartupScopedEvent: (sessionId: string, event: unknown) => void;
  syncState: (nextState: SubagentState, meta: PersistSnapshotMeta) => Promise<void>;
  createPersistMeta: (source: PersistSnapshotMeta['source']) => PersistSnapshotMeta;
};

/**
 * Wraps the caller's syncState with a version-based guard that prevents
 * overwriting live state that was modified (e.g. by the refresh path)
 * between the event clone and persist. Follows the same snapshot-version
 * pattern used in the refresh orchestrator.
 *
 * A `snapshotVersion` is captured at clone time. At persist time the guard
 * compares it with the live state. If they differ, live children take
 * precedence and only new (absent) children from the event are merged in.
 */
const createVersionGuardedSyncState = (input: MergeEventStateInput) => {
  let snapshotBaseState: SubagentState | undefined;

  const captureBaseState = (baseState: SubagentState): void => {
    snapshotBaseState = baseState;
  };

  const guard = async (nextState: SubagentState, meta: PersistSnapshotMeta): Promise<void> => {
    if (!snapshotBaseState || input.getCurrentState() === snapshotBaseState) {
      await input.syncState(nextState, meta);
      return;
    }

    // Live state was modified after our clone. Merge new children from
    // nextState into the live state rather than overwriting it.
    const liveState = cloneState(input.getCurrentState());
    for (const [id, child] of Object.entries(nextState.children)) {
      if (!liveState.children[id]) upsertRunningChild(liveState, child);
    }
    if (nextState.updatedAt > liveState.updatedAt) {
      liveState.updatedAt = nextState.updatedAt;
    }
    await input.syncState(liveState, meta);
  };

  return { captureBaseState, guard };
};

/**
 * Builds the event-merge loop used by the refresh orchestrator. Encapsulates
 * the clone/apply/prune/persist cycle for one normalized event so the
 * orchestrator can stay focused on its refresh responsibilities.
 *
 * The handler is wrapped in a serialized task queue so that concurrent event
 * delivery (e.g. a batch arriving while the previous merge is still awaiting
 * syncState) does not interleave clone/apply/prune cycles and cause lost or
 * overwritten mutations.
 */
export const createMergeEventState = (input: MergeEventStateInput) => {
  const { captureBaseState, guard } = createVersionGuardedSyncState(input);

  const mergeEvent = async (event: unknown): Promise<void> => {
    if (input.isDisposed()) return;

    const normalizedEvent = normalizeEventPayload(event);
    if (!normalizedEvent) return;

    const eventSessionId = extractSessionId(normalizedEvent);
    const currentSessionId = input.getCurrentSessionId();
    const currentState = input.getCurrentState();
    const eventInfo = normalizedEvent.properties?.info;
    const eventParentId = typeof eventInfo?.parentID === 'string' ? eventInfo.parentID : undefined;
    const relatedSessionIds = new Set(
      Object.values(currentState.children).flatMap((child) => [child.id, child.targetSessionID].filter(Boolean)),
    );
    const isParentScopedSessionEvent =
      (normalizedEvent.type === 'session.created' || normalizedEvent.type === 'session.updated') &&
      eventParentId === currentSessionId;
    const isRelated =
      !currentSessionId ||
      eventSessionId === currentSessionId ||
      (eventSessionId ? relatedSessionIds.has(eventSessionId) : false) ||
      isParentScopedSessionEvent;
    if (currentSessionId && !isRelated) return;
    if (!input.getCurrentSessionId() && eventSessionId) {
      if (input.isBufferingStartupScopedEvents()) {
        input.bufferStartupScopedEvent(eventSessionId, normalizedEvent);
      }
      return;
    }

    let nextState: SubagentState;
    let snapshotBaseState: SubagentState | undefined;
    try {
      // Capture the live state version BEFORE we clone so that any
      // interleaving modification (e.g. from the refresh path) between
      // clone and persist can be detected as a version mismatch and
      // handled by the merge guard.
      snapshotBaseState = input.getCurrentState();
      nextState = cloneState(snapshotBaseState);
    } catch (e) {
      // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
      // single grep on `sessionId=` correlates every failure to its session.
      console.warn(
        '[agent-monitor] Failed to clone state for event processing — sessionId=',
        eventSessionId ?? input.getCurrentSessionId(),
        ':',
        e instanceof Error ? e : String(e),
      );
      return;
    }
    const changed = applySubagentEvent(nextState, normalizedEvent);
    if (!changed) return;

    pruneTerminalChildren(nextState);
    captureBaseState(snapshotBaseState);
    await guard(nextState, input.createPersistMeta('event'));
  };

  return createSerializedTaskQueue(mergeEvent);
};

// Re-export so consumers don't need a second import path.
export { isTerminalStatus };
