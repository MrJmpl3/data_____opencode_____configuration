// Refresh orchestration — the main createTuiRuntimeRefresh.
//
// The merge-event-state loop lives in `events/merge.ts` and the token backfill
// runner lives in `refresh/token-backfill.ts` so this module can focus on the
// refresh path itself: probe recovery, status hydration, stale-running
// reconciliation, and persistence.

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { cloneState } from '../../../../kit/clone.ts';
import { isRealSessionChild } from '../../domain/state/core.ts';
import { isTerminalStatus, pruneTerminalChildren } from '../../domain/state/maintenance.ts';
import type { SubagentChild, SubagentState } from '../../domain/types.ts';
import { hydrateStateFromRecoverySources } from '../../infrastructure/recovery.ts';
import type { RecoveryResult, RecoverySource } from '../../infrastructure/recovery.ts';
import { normalizeChildrenResponse } from '../../domain/reconcile/normalize.ts';
import { reconcileNormalizedChildrenState } from '../../domain/reconcile/reconcile.ts';

import { createMergeEventState } from '../events/merge.ts';
import { createCoalescedTaskRunner } from '../queue.ts';
import { createSessionClientBoundary } from '../session/session-client.ts';
import type { PersistSnapshotMeta } from '../snapshot.ts';
import type { ResolvedSubagentStatusPluginOptions } from '../options.ts';
import type { createRuntimeSessionScopeHelpers } from '../session/scope.ts';
import { resolveChildSessionId as resolveSessionRowSessionId } from '../session/navigate.ts';

import { hydrateChildStatusesFromClient, hydrateChildStatusesFromTuiState } from './hydrate-client.ts';
import type { StatusHydrationOptions } from './hydrate.ts';
import {
  resolveStaleRunningProbeTargets,
  settleStaleRunningProbeTargets,
  type StaleRunningProbeState,
} from './stale.ts';
import { createTokenBackfillRunner } from './token-backfill.ts';
import type { StaleRunningProbePolicy } from '../options.ts';

type RuntimeSessionScopeHelpers = ReturnType<typeof createRuntimeSessionScopeHelpers>;

type RuntimeStateAccess = {
  getState: () => SubagentState;
  getSessionId: () => string;
};

type CreatePersistMeta = (source: PersistSnapshotMeta['source']) => PersistSnapshotMeta;

type RefreshRequest = {
  sessionId: string;
  sessionToken: number;
};

const createEmptyRecoveryResult = (): RecoveryResult => ({
  changed: false,
  authoritativeSessionIDs: [],
});

const resolveTerminalRecoverySessionIDs = (
  state: SubagentState,
  authoritativeSessionIDs: ReadonlySet<string>,
): Set<string> => {
  const terminalSessionIDs = new Set<string>();

  for (const child of Object.values(state.children)) {
    if (!isRealSessionChild(child) || !isTerminalStatus(child.status)) continue;

    const sessionId = resolveSessionRowSessionId(child);
    if (sessionId && authoritativeSessionIDs.has(sessionId)) {
      terminalSessionIDs.add(sessionId);
    }
  }

  return terminalSessionIDs;
};

const hydrateRecoverySourcesSafely = async (input: {
  state: SubagentState;
  directory: string;
  parentSessionID: string;
  recoverySources: RecoverySource[];
}): Promise<RecoveryResult> => {
  try {
    return await hydrateStateFromRecoverySources(
      input.state,
      { directory: input.directory, parentSessionID: input.parentSessionID },
      input.recoverySources,
    );
  } catch (e) {
    // Logged in the format: "[agent-monitor] <message> — sessionId=<id>: <error>"
    // so a single grep on `sessionId=` correlates every failure to its session.
    console.warn(
      '[agent-monitor] Recovery hydration failed — sessionId=',
      input.parentSessionID,
      ':',
      e instanceof Error ? e : String(e),
    );
    return createEmptyRecoveryResult();
  }
};

const resolveClientSnapshotSessionIDs = (children: readonly SubagentChild[]): string[] => {
  return children
    .filter((child) => isRealSessionChild(child))
    .map((child) => resolveSessionRowSessionId(child))
    .filter((candidate): candidate is string => Boolean(candidate));
};

const mergeAuthoritativeSessionIDs = (
  recoverySessionIDs: ReadonlySet<string>,
  children: readonly SubagentChild[],
): Set<string> => {
  const authoritativeSessionIDs = new Set(recoverySessionIDs);

  for (const childSessionID of resolveClientSnapshotSessionIDs(children)) {
    authoritativeSessionIDs.add(childSessionID);
  }

  return authoritativeSessionIDs;
};

export const createTuiRuntimeRefresh = (
  api: TuiPluginApi,
  input: {
    state: RuntimeStateAccess;
    sessionScope: RuntimeSessionScopeHelpers;
    recoverySources: RecoverySource[];
    staleRunningProbePolicy: ResolvedSubagentStatusPluginOptions['staleRunningProbePolicy'];
    staleRunningProbeStateBySessionId: Map<string, StaleRunningProbeState>;
    createPersistMeta: CreatePersistMeta;
    syncState: (nextState: SubagentState, meta: PersistSnapshotMeta) => Promise<void>;
    isDisposed: () => boolean;
  },
) => {
  const sessionClient = createSessionClientBoundary(api);

  const isInactiveSessionToken = (sessionToken: number): boolean =>
    input.isDisposed() || sessionToken !== input.sessionScope.currentSessionToken();

  const mergeEventState = createMergeEventState({
    isDisposed: input.isDisposed,
    getCurrentState: input.state.getState,
    getCurrentSessionId: input.state.getSessionId,
    isBufferingStartupScopedEvents: input.sessionScope.isBufferingStartupScopedEvents,
    bufferStartupScopedEvent: input.sessionScope.bufferStartupScopedEvent,
    syncState: input.syncState,
    createPersistMeta: input.createPersistMeta,
  });

  const refreshRunner = createCoalescedTaskRunner(async (request: RefreshRequest): Promise<void> => {
    const { sessionId, sessionToken } = request;
    if (isInactiveSessionToken(sessionToken)) return;
    if (!sessionId) return;

    // nextState is hoisted so the finally block can clear `recovering` even
    // when the inner try block throws — keeping the flag consistent with the
    // actual sync state on disk.
    let nextState: SubagentState | undefined;

    try {
      nextState = cloneState(input.state.getState());
      nextState.recovering = true;
      const directory = api.state.path.directory;
      const recovered = await hydrateRecoverySourcesSafely({
        state: nextState,
        directory,
        parentSessionID: sessionId,
        recoverySources: input.recoverySources,
      });
      if (isInactiveSessionToken(sessionToken)) return;

      const recoverySessionIDs = new Set(recovered.authoritativeSessionIDs);
      const protectedRecoverySessionIDs = new Set(
        recovered.protectedTerminalSessionIDs ?? recovered.authoritativeSessionIDs,
      );
      const terminalRecoverySessionIDs = resolveTerminalRecoverySessionIDs(nextState, protectedRecoverySessionIDs);
      let response: unknown;
      try {
        response = await sessionClient.listChildren(sessionId);
      } catch (e) {
        // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
        // single grep on `sessionId=` correlates every failure to its session.
        console.warn(
          '[agent-monitor] listChildren failed — sessionId=',
          sessionId,
          ':',
          e instanceof Error ? e : String(e),
        );
        if (nextState && recovered.changed) {
          await input.syncState(nextState, input.createPersistMeta('refresh'));
        }
        return;
      }
      if (isInactiveSessionToken(sessionToken)) return;

      const incomingChildren = normalizeChildrenResponse(response);
      const authoritativeSessionIDs = mergeAuthoritativeSessionIDs(recoverySessionIDs, incomingChildren);
      const { changed, nextState: reconciledState } = reconcileNormalizedChildrenState(nextState, incomingChildren, {
        recoverySessionIDs,
        terminalRecoverySessionIDs,
      });
      nextState = reconciledState;

      const staleRunningProbeTargets = resolveStaleRunningProbeTargets(
        nextState,
        input.staleRunningProbeStateBySessionId,
        input.staleRunningProbePolicy,
        Date.now(),
      );
      const runningEvidenceSessionIDs = new Set<string>();
      const tuiStatusHydrated = hydrateChildStatusesFromTuiState(
        api,
        nextState,
        staleRunningProbeTargets,
        runningEvidenceSessionIDs,
        { terminalRecoverySessionIDs },
      );
      const clientStatusHydrated = await hydrateChildStatusesFromClient(
        api,
        nextState,
        staleRunningProbeTargets,
        runningEvidenceSessionIDs,
        { terminalRecoverySessionIDs },
      );
      const staleRunningSettled = settleStaleRunningProbeTargets(
        nextState,
        input.staleRunningProbeStateBySessionId,
        staleRunningProbeTargets,
        {
          authoritativeSessionIDs,
          runningEvidenceSessionIDs,
          policy: input.staleRunningProbePolicy,
          nowMs: Date.now(),
        },
      );
      const pruned = pruneTerminalChildren(nextState);
      if (isInactiveSessionToken(sessionToken)) return;
      if (
        !recovered.changed &&
        !changed &&
        !tuiStatusHydrated &&
        !clientStatusHydrated &&
        !staleRunningSettled &&
        !pruned
      ) {
        return;
      }

      await input.syncState(nextState, input.createPersistMeta('refresh'));
    } catch (e) {
      console.warn('[agent-monitor] Refresh failed — sessionId=', sessionId, ':', e instanceof Error ? e : String(e));
    } finally {
      // Clear `recovering` only when we actually allocated nextState so the
      // flag never ends up out of sync with what the persistence layer wrote.
      if (nextState) {
        nextState.recovering = false;
      }
    }
  });

  const tokenBackfill = createTokenBackfillRunner({
    getState: input.state.getState,
    isInactiveSessionToken,
    syncState: input.syncState,
    createPersistMeta: input.createPersistMeta,
  });

  const refresh = async (
    sessionId = input.state.getSessionId(),
    sessionToken = input.sessionScope.currentSessionToken(),
  ): Promise<void> => {
    await refreshRunner({ sessionId, sessionToken });
    if (isInactiveSessionToken(sessionToken)) return;
    await input.sessionScope.replayDeferredStartupScopedEvents(
      sessionId,
      sessionToken,
      mergeEventState,
      input.isDisposed,
    );
    if (isInactiveSessionToken(sessionToken)) return;

    tokenBackfill.fireAndForget({ sessionId, sessionToken });
  };

  return {
    mergeEventState,
    refresh,
  };
};

// Re-export to satisfy consumers that import option types via this module.
export type { StaleRunningProbePolicy, StatusHydrationOptions };
