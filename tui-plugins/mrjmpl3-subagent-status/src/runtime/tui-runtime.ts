import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import type { Accessor } from 'solid-js';

import { useClockTicker } from '@mrjmpl3/tui-kit/runtime';
import { installEventBridge } from './events/bridge.ts';
import { createBufferedTaskQueue } from './queue.ts';
import { normalizeSubagentStatusPluginOptions, type ResolvedSubagentStatusPluginOptions } from './options.ts';
import { debugLog, setDebugEnabled } from '../shared/debug.ts';
import { resolveSessionSlotTransition } from './navigation.ts';
import { createRuntimeSessionScopeHelpers } from './session-scope.ts';
import { childEvidenceTimestampMs, createEmptyState, markChildStatus } from '../domain/state.ts';
import type { SubagentState } from '../domain/types.ts';
import {
  createPersistQueue,
  loadState,
  resolveStatePath,
  resolveTextPath,
  shouldPreserveStateOnStartup,
} from '../infrastructure/persistence.ts';
import { createRecoverySources } from '../infrastructure/recovery-sources.ts';
import { formatPersistedSnapshot, type PersistSnapshotMeta } from './persisted-snapshot.ts';
import { createTuiRuntimeRefresh } from './tui-runtime-refresh.ts';
import { isPlainObject as isRecord } from '@mrjmpl3/tui-kit';

export type TuiRuntime = {
  bootstrap: () => Promise<void>;
  refreshFromSlot: (slotInput: unknown) => void;
  /** Mark the sidebar slot as visible/hidden so the 1Hz clock can be gated.
   * When useSlotVisibility is available, this delegates to the Accessor.
   * Otherwise falls back to an internal boolean. */
  setSlotVisible: (visible: boolean) => void;
  dispose: () => void;
};

export const createTuiRuntime = (
  api: TuiPluginApi,
  input: {
    getState: () => SubagentState;
    setState: (state: SubagentState) => void;
    getSessionId: () => string;
    setSessionId: (sessionId: string) => void;
    setNowMs: (nowMs: number) => void;
    /** Accessor from useSlotVisibility — true while the sidebar slot is mounted.
     * Defaults to `() => true` so callers that don't use kit primitives are unaffected. */
    isSlotVisible?: Accessor<boolean>;
    /**
     * Whether the sidebar has visible content (active/recent children). When
     * false (or omitted), the clock still respects the slot-visibility gate.
     * Defaults to `() => true` so callers that don't track content are unaffected.
     */
    hasVisibleContent?: () => boolean;
  },
  options: ResolvedSubagentStatusPluginOptions = normalizeSubagentStatusPluginOptions(undefined),
): TuiRuntime => {
  setDebugEnabled(options.debug);

  const statePath = resolveStatePath({
    workspaceDirectory: api.state.path.directory,
    statePath: options.persistence.statePath,
  });
  const textPath = resolveTextPath(statePath);
  const visibilityPolicy = options.visibility;
  const persistQueuedSnapshot = createPersistQueue(statePath, textPath, (state, meta: PersistSnapshotMeta) =>
    formatPersistedSnapshot(state, meta, visibilityPolicy),
  );
  const recoverySources = createRecoverySources({
    sqliteDatabasePath: options.recovery.sqliteDatabasePath,
    hardStaleAfterMs: options.staleRunningProbePolicy.hardStaleAfterMs,
  });
  const staleRunningProbePolicy = options.staleRunningProbePolicy;
  const bufferedEvents = createBufferedTaskQueue(async (event: unknown) => {
    await mergeEventState(event);
  });

  let disposed = false;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let clockTickerDispose: (() => void) | undefined;
  let lastEventType: string | undefined;
  // Slot-visibility gate: useSlotVisibility's Accessor takes priority when
  // provided; otherwise fall back to an internal boolean (tests/compat).
  let internalSlotVisible = false;
  const externalSlotVisible = input.isSlotVisible;
  const isSlotVisible = (): boolean =>
    externalSlotVisible ? externalSlotVisible() : internalSlotVisible;
  const setSlotVisible = (visible: boolean): void => {
    internalSlotVisible = visible;
  };
  const hasVisibleContent = input.hasVisibleContent ?? (() => true);

  const createPersistMeta = (source: PersistSnapshotMeta['source']): PersistSnapshotMeta => ({
    source,
    lastEventType,
    bufferedEventCount: bufferedEvents.size(),
  });

  const syncState = async (nextState: SubagentState, meta: PersistSnapshotMeta): Promise<void> => {
    if (disposed) return;
    input.setState(nextState);
    await persistQueuedSnapshot(nextState, meta);
  };

  const markHardStaleRunningChildren = (state: SubagentState): void => {
    const hardStaleAfterMs = staleRunningProbePolicy.hardStaleAfterMs;
    if (hardStaleAfterMs <= 0) return;

    const nowMs = Date.now();
    for (const child of Object.values(state.children)) {
      if (child.status !== 'running') continue;

      const childEvidenceMs = childEvidenceTimestampMs(child);
      if (nowMs - childEvidenceMs < hardStaleAfterMs) continue;

      const errorAt = new Date(Math.max(nowMs, childEvidenceMs)).toISOString();
      markChildStatus(state, child.id, 'error', errorAt);
    }
  };

  const sessionScope = createRuntimeSessionScopeHelpers({
    getSessionId: input.getSessionId,
    setSessionId: input.setSessionId,
    syncState,
    createRefreshMeta: () => createPersistMeta('refresh'),
  });

  const { mergeEventState, refresh } = createTuiRuntimeRefresh(api, {
    state: {
      getState: input.getState,
      getSessionId: input.getSessionId,
    },
    sessionScope,
    recoverySources,
    staleRunningProbePolicy,
    staleRunningProbeStateBySessionId: new Map(),
    createPersistMeta,
    syncState,
    isDisposed: () => disposed,
  });

  const refreshFromSlot = (slotInput: unknown): void => {
    const transition = resolveSessionSlotTransition(
      input.getSessionId(),
      slotInput,
      Object.keys(input.getState().children).length > 0,
    );

    if (!transition.nextSessionId) {
      if (transition.resetState) {
        sessionScope.resetSessionScope();
      }
      return;
    }

    if (transition.resetState) {
      sessionScope.beginSessionScope(transition.nextSessionId);
      void refresh(transition.nextSessionId);
      return;
    }

    if (transition.shouldRefresh) {
      void refresh(transition.nextSessionId);
    }
  };

  const disposeEventBridge = installEventBridge(api, refresh, (event) => {
    lastEventType = isRecord(event) && typeof event.type === 'string' ? event.type : undefined;
    bufferedEvents.push(event);
  });

  clockTickerDispose = useClockTicker({
    active: () => isSlotVisible() && hasVisibleContent(),
    onTick: (nowMs: number) => input.setNowMs(nowMs),
  });

  reconcileTimer = setInterval(() => {
    if (!disposed && input.getSessionId()) {
      void refresh();
    }
  }, staleRunningProbePolicy.refreshIntervalMs);

  const bootstrap = async (): Promise<void> => {
    try {
      const preserveState = shouldPreserveStateOnStartup({
        preserveStateOnStartup: options.persistence.preserveStateOnStartup,
      });
      debugLog(`[subagent-status] bootstrap: preserveStateOnStartup=${preserveState} statePath=${statePath}`);
      if (!preserveState) {
        await syncState(createEmptyState(), createPersistMeta('startup'));
      } else {
        const loadedState = await loadState(statePath, {
          recoveryContext: {
            directory: api.state.path.directory,
            parentSessionID: input.getSessionId() || undefined,
          },
          recoverySources,
        });
        markHardStaleRunningChildren(loadedState);
        await syncState(loadedState, createPersistMeta('load'));
      }

      debugLog(`[subagent-status] bootstrap: calling refresh with sessionId=${input.getSessionId()}`);
      await refresh(input.getSessionId());
    } finally {
      await bufferedEvents.markReady();
      sessionScope.finishStartupScopedEventBuffering();
      if (bufferedEvents.wasTruncated()) {
        void refresh();
      }
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    if (clockTickerDispose) clockTickerDispose();
    if (reconcileTimer) clearInterval(reconcileTimer);
    disposeEventBridge();
  };

  return {
    bootstrap,
    refreshFromSlot,
    setSlotVisible,
    dispose,
  };
};
