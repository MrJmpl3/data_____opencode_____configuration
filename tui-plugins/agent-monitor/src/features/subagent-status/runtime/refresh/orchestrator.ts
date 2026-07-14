// Refresh orchestration — the main createTuiRuntimeRefresh.
//
// The merge-event-state loop lives in `events/merge.ts` and the token backfill
// runner lives in `refresh/token-backfill.ts` so this module can focus on the
// refresh path itself: probe recovery, status hydration, stale-running
// reconciliation, and persistence.

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { cloneState } from '../../../../kit/clone.ts';
import { isRealSessionChild } from '../../domain/state/core.ts';
import { childEvidenceTimestampMs, isTerminalStatus, pruneTerminalChildren } from '../../domain/state/maintenance.ts';
import { markChildStatus, upsertRunningChild } from '../../domain/state/mutations.ts';
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

const EMPTY_RECOVERY_RESULT: RecoveryResult = {
  changed: false,
  authoritativeSessionIDs: [],
};

const resolveTerminalRecoverySessionIDs = (
  state: SubagentState,
  authoritativeSessionIDs: ReadonlySet<string>,
): Set<string> => {
  const terminalSessionIDs = new Set<string>();

  for (const child of Object.values(state.children)) {
    if (!isTerminalStatus(child.status)) continue;
    if (!isRealSessionChild(child) && !child.targetSessionID) continue;

    const sessionId = resolveSessionRowSessionId(child);
    if (sessionId && authoritativeSessionIDs.has(sessionId)) {
      terminalSessionIDs.add(sessionId);
    }
  }

  return terminalSessionIDs;
};

export const mergeRefreshStatus = (
  state: SubagentState,
  baseState: SubagentState,
  refreshState: SubagentState,
  authoritativeTerminalSessionIDs: ReadonlySet<string> = new Set(),
): boolean => {
  let changed = false;
  for (const [id, refreshChild] of Object.entries(refreshState.children)) {
    const liveChild = state.children[id];
    if (!liveChild) {
      changed = upsertRunningChild(state, refreshChild) || changed;
      if (isTerminalStatus(refreshChild.status)) {
        const terminalRecovery = authoritativeTerminalSessionIDs.has(refreshChild.targetSessionID ?? refreshChild.id);
        changed =
          markChildStatus(
            state,
            refreshChild.targetSessionID ?? refreshChild.id,
            refreshChild.status,
            refreshChild.endedAt ?? refreshChild.updatedAt,
            { allowOlderTerminalEvidence: terminalRecovery },
          ) || changed;
      }
      continue;
    }
    const baseChild = baseState.children[id];
    const refreshChanged =
      !baseChild ||
      refreshChild.status !== baseChild.status ||
      refreshChild.updatedAt !== baseChild.updatedAt ||
      refreshChild.endedAt !== baseChild.endedAt;
    if (!refreshChanged) continue;
    const terminalRecovery =
      isTerminalStatus(refreshChild.status) &&
      authoritativeTerminalSessionIDs.has(refreshChild.targetSessionID ?? refreshChild.id);
    if (isTerminalStatus(refreshChild.status)) {
      if (
        !terminalRecovery &&
        liveChild.status !== 'running' &&
        childEvidenceTimestampMs(refreshChild) <= childEvidenceTimestampMs(liveChild)
      )
        continue;
      if (
        !terminalRecovery &&
        liveChild.status === 'running' &&
        childEvidenceTimestampMs(refreshChild) < childEvidenceTimestampMs(liveChild)
      )
        continue;
      changed =
        markChildStatus(
          state,
          refreshChild.targetSessionID ?? refreshChild.id,
          refreshChild.status,
          refreshChild.endedAt ?? refreshChild.updatedAt,
          { allowOlderTerminalEvidence: terminalRecovery },
        ) || changed;
    } else if (
      liveChild.status !== 'running' ||
      childEvidenceTimestampMs(refreshChild) <= childEvidenceTimestampMs(liveChild)
    ) {
      continue;
    }
    if (!state.children[id]) continue;
    state.children[id] = {
      ...state.children[id],
      status: refreshChild.status,
      updatedAt: refreshChild.updatedAt,
      endedAt: refreshChild.endedAt,
      color: refreshChild.color,
      elapsedMs: refreshChild.elapsedMs,
    };
    changed = true;
  }
  return changed;
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
    return EMPTY_RECOVERY_RESULT;
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
    publishState: (state: SubagentState) => void;
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
    let baseStateAtCloneTime: SubagentState | undefined;

    try {
      baseStateAtCloneTime = input.state.getState();
      nextState = cloneState(baseStateAtCloneTime);
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
      let hasListChildrenResponse = true;
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
        hasListChildrenResponse = false;
        // Continue without the snapshot — recovery hydration and stale
        // running probes are still viable.
      }
      if (isInactiveSessionToken(sessionToken)) return;

      let changed = false;
      const authoritativeSessionIDs = hasListChildrenResponse
        ? mergeAuthoritativeSessionIDs(recoverySessionIDs, normalizeChildrenResponse(response))
        : recoverySessionIDs;

      let incomingChildren: SubagentChild[] | undefined;
      if (hasListChildrenResponse) {
        incomingChildren = normalizeChildrenResponse(response);
        const { changed: reconcileChanged, nextState: reconciledState } = reconcileNormalizedChildrenState(
          nextState,
          incomingChildren,
          {
            recoverySessionIDs,
            terminalRecoverySessionIDs,
          },
        );
        changed = reconcileChanged;
        nextState = reconciledState;
      }

      const staleRunningProbeTargets = resolveStaleRunningProbeTargets(
        nextState,
        input.staleRunningProbeStateBySessionId,
        input.staleRunningProbePolicy,
        Date.now(),
      );

      // Include API-reported running children in hydration targets so the
      // probes can authoritatively verify or reject their running status.
      const apiRunningSessionIDs: string[] = incomingChildren
        ? incomingChildren
            .filter((child) => child.status === 'running')
            .filter((child) => {
              const sessionId = resolveSessionRowSessionId(child);
              return !sessionId || !terminalRecoverySessionIDs?.has(sessionId);
            })
            .map((child) => resolveSessionRowSessionId(child))
            .filter((candidate): candidate is string => Boolean(candidate))
        : [];
      const hydrationTargetSessionIDs = [...new Set([...staleRunningProbeTargets, ...apiRunningSessionIDs])];

      const runningEvidenceSessionIDs = new Set<string>();
      const tuiStatusHydrated = hydrateChildStatusesFromTuiState(
        api,
        nextState,
        hydrationTargetSessionIDs,
        runningEvidenceSessionIDs,
        { terminalRecoverySessionIDs },
      );
      const clientStatusHydrated = await hydrateChildStatusesFromClient(
        api,
        nextState,
        hydrationTargetSessionIDs,
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

      // Check whether the event path (mergeEventState) modified the live
      // state since we cloned. If it did, a terminal child in the live state
      // must not be overwritten by stale listChildren data. We still persist
      // children that were added by recovery (not present in the live state)
      // and clear the `recovering` flag.
      if (baseStateAtCloneTime != null && input.state.getState() !== baseStateAtCloneTime) {
        if (
          recovered.changed ||
          changed ||
          tuiStatusHydrated ||
          clientStatusHydrated ||
          staleRunningSettled ||
          pruned
        ) {
          const mergedState = cloneState(input.state.getState());
          const mergedRefreshStatus = mergeRefreshStatus(
            mergedState,
            baseStateAtCloneTime,
            nextState,
            protectedRecoverySessionIDs,
          );
          mergedState.recovering = false;
          nextState = undefined;
          if (
            mergedRefreshStatus ||
            recovered.changed ||
            changed ||
            tuiStatusHydrated ||
            clientStatusHydrated ||
            staleRunningSettled ||
            pruned
          )
            await input.syncState(mergedState, input.createPersistMeta('refresh'));
        }
        return;
      }

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
      if (nextState) {
        const liveState = input.state.getState();
        if (liveState !== nextState && liveState.recovering) {
          const corrected = cloneState(liveState);
          corrected.recovering = false;
          await input.syncState(corrected, input.createPersistMeta('refresh'));
        } else if (liveState === nextState) {
          const corrected = cloneState(nextState);
          corrected.recovering = false;
          input.publishState(corrected);
        }
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
