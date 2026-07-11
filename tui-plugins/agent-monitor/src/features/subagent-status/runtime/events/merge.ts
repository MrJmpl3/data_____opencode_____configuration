import { cloneState } from '../../../../kit/clone.ts';
import { applySubagentEvent } from './handle.ts';
import { extractSessionId } from './extract.ts';
import type { PersistSnapshotMeta } from '../snapshot.ts';
import type { SubagentState } from '../../domain/types.ts';
import { normalizeEventPayload } from './event-payload.ts';
import { isTerminalStatus, pruneTerminalChildren } from '../../domain/state/maintenance.ts';

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
 * Builds the event-merge loop used by the refresh orchestrator. Encapsulates
 * the clone/apply/prune/persist cycle for one normalized event so the
 * orchestrator can stay focused on its refresh responsibilities.
 */
export const createMergeEventState = (input: MergeEventStateInput) => {
  return async (event: unknown): Promise<void> => {
    if (input.isDisposed()) return;

    const normalizedEvent = normalizeEventPayload(event);
    if (!normalizedEvent) return;

    const eventSessionId = extractSessionId(normalizedEvent);
    if (input.getCurrentSessionId() && eventSessionId && eventSessionId !== input.getCurrentSessionId()) return;
    if (!input.getCurrentSessionId() && eventSessionId) {
      if (input.isBufferingStartupScopedEvents()) {
        input.bufferStartupScopedEvent(eventSessionId, normalizedEvent);
      }
      return;
    }

    let nextState: SubagentState;
    try {
      nextState = cloneState(input.getCurrentState());
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
    await input.syncState(nextState, input.createPersistMeta('event'));
  };
};

// Re-export so consumers don't need a second import path.
export { isTerminalStatus };
