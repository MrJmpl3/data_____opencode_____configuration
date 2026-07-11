import { cloneState } from '../../../../kit/clone.ts';
import { pruneTerminalChildren } from '../../domain/state/maintenance.ts';
import type { SubagentState } from '../../domain/types.ts';
import type { PersistSnapshotMeta } from '../snapshot.ts';
import { createCoalescedTaskRunner } from '../queue.ts';

import { hydrateChildTokensFromLogs } from './hydrate.ts';

export type TokenBackfillRequest = {
  sessionId: string;
  sessionToken: number;
};

export type TokenBackfillInput = {
  getState: () => SubagentState;
  isInactiveSessionToken: (sessionToken: number) => boolean;
  syncState: (nextState: SubagentState, meta: PersistSnapshotMeta) => Promise<void>;
  createPersistMeta: (source: PersistSnapshotMeta['source']) => PersistSnapshotMeta;
};

/**
 * Creates a coalesced task runner that re-hydrates token usage for done
 * children from the logs pipeline and persists the result when anything
 * changed. Returns the runner plus a fire-and-forget helper for callers
 * that don't need to await completion.
 */
export const createTokenBackfillRunner = (input: TokenBackfillInput) => {
  const runner = createCoalescedTaskRunner(async (request: TokenBackfillRequest): Promise<void> => {
    const { sessionId, sessionToken } = request;
    if (input.isInactiveSessionToken(sessionToken)) return;

    try {
      if (!sessionId) return;

      // Skip clone if no done children exist — nothing to backfill.
      const currentState = input.getState();
      if (!Object.values(currentState.children).some((c) => c.status === 'done')) return;

      const nextState = cloneState(currentState);
      const hydrated = await hydrateChildTokensFromLogs(nextState);
      const pruned = pruneTerminalChildren(nextState);
      if (input.isInactiveSessionToken(sessionToken)) return;
      if (!hydrated && !pruned) {
        return;
      }

      await input.syncState(nextState, input.createPersistMeta('refresh'));
    } catch (e) {
      // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
      // single grep on `sessionId=` correlates every failure to its session.
      console.warn(
        '[agent-monitor] Token backfill failed — sessionId=',
        sessionId,
        ':',
        e instanceof Error ? e : String(e),
      );
    }
  });

  return {
    runner,
    fireAndForget: (request: TokenBackfillRequest): void => {
      runner(request).catch((e) => {
        // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
        // single grep on `sessionId=` correlates every failure to its session.
        console.warn(
          '[agent-monitor] Token backfill failed (fire-and-forget) — sessionId=',
          request.sessionId,
          ':',
          e instanceof Error ? e : String(e),
        );
      });
    },
  };
};
