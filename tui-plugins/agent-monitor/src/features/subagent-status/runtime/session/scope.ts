import { createEmptyState } from '../../domain/state/core.ts';
import type { SubagentState } from '../../domain/types.ts';
import type { PersistSnapshotMeta } from '../snapshot.ts';

export const MAX_DEFERRED_STARTUP_SCOPED_EVENTS = 512;

export const createRuntimeSessionScopeHelpers = (input: {
  getSessionId: () => string;
  setSessionId: (sessionId: string) => void;
  syncState: (state: SubagentState, meta: PersistSnapshotMeta) => Promise<void>;
  createRefreshMeta: () => PersistSnapshotMeta;
}) => {
  let activeSessionToken = 0;
  let bufferingStartupScopedEvents = true;
  const deferredStartupScopedEvents = new Map<string, unknown[]>();
  let deferredStartupScopedEventCount = 0;

  const invalidateSessionScope = (): number => {
    activeSessionToken += 1;
    return activeSessionToken;
  };

  const persistEmptyScopedState = (): void => {
    const sessionId = input.getSessionId();
    input.syncState(createEmptyState(), input.createRefreshMeta()).catch((e) => {
      // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
      // single grep on `sessionId=` correlates every failure to its session.
      console.warn(
        '[agent-monitor] Failed to persist empty scoped state — sessionId=',
        sessionId,
        ':',
        e instanceof Error ? e : String(e),
      );
    });
  };

  const resetSessionScope = (): void => {
    invalidateSessionScope();
    input.setSessionId('');
    persistEmptyScopedState();
  };

  const beginSessionScope = (sessionId: string): number => {
    const token = invalidateSessionScope();
    input.setSessionId(sessionId);
    persistEmptyScopedState();
    return token;
  };

  const dropOldestDeferredStartupScopedEvent = (): void => {
    const oldest = deferredStartupScopedEvents.entries().next().value;
    if (!oldest) return;
    const [sessionId, events] = oldest;
    events.shift();
    deferredStartupScopedEventCount = Math.max(0, deferredStartupScopedEventCount - 1);
    if (events.length === 0) deferredStartupScopedEvents.delete(sessionId);
  };

  const bufferStartupScopedEvent = (sessionId: string, event: unknown): void => {
    const events = deferredStartupScopedEvents.get(sessionId);
    if (events) events.push(event);
    else deferredStartupScopedEvents.set(sessionId, [event]);
    deferredStartupScopedEventCount += 1;
    while (deferredStartupScopedEventCount > MAX_DEFERRED_STARTUP_SCOPED_EVENTS) {
      dropOldestDeferredStartupScopedEvent();
    }
  };

  const replayDeferredStartupScopedEvents = async (
    sessionId: string,
    sessionToken: number,
    replayEvent: (event: unknown) => Promise<void>,
    isDisposed: () => boolean,
  ): Promise<void> => {
    if (!sessionId) return;
    const events = deferredStartupScopedEvents.get(sessionId);
    if (!events || events.length === 0) return;
    deferredStartupScopedEvents.delete(sessionId);
    deferredStartupScopedEventCount = Math.max(0, deferredStartupScopedEventCount - events.length);
    for (const event of events) {
      if (isDisposed() || sessionToken !== activeSessionToken || input.getSessionId() !== sessionId) return;
      await replayEvent(event);
    }
  };

  return {
    beginSessionScope,
    bufferStartupScopedEvent,
    currentSessionToken: (): number => activeSessionToken,
    finishStartupScopedEventBuffering: (): void => {
      bufferingStartupScopedEvents = false;
    },
    invalidateSessionScope,
    isBufferingStartupScopedEvents: (): boolean => bufferingStartupScopedEvents,
    replayDeferredStartupScopedEvents,
    resetSessionScope,
  };
};
