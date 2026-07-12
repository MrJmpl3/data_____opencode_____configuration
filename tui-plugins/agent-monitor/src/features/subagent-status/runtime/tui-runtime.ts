import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import type { Accessor } from 'solid-js';

import { useClockTicker } from '../../../kit/use-clock-ticker.ts';
import { installEventBridge } from './events/bridge.ts';
import { normalizeSubagentStatusPluginOptions, type ResolvedSubagentStatusPluginOptions } from './options.ts';
import { debugLog, setDebugEnabled } from '../shared/display.ts';
import { resolveSessionSlotTransition } from './session/navigate.ts';
import { createRuntimeSessionScopeHelpers } from './session/scope.ts';
import { markHardStaleRunningChildren } from '../domain/state/maintenance.ts';
import { createEmptyState } from '../domain/state/core.ts';
import type { SubagentState } from '../domain/types.ts';
import { loadState, shouldPreserveStateOnStartup } from '../infrastructure/persistence.ts';
import { createTuiRuntimeRefresh } from './refresh/orchestrator.ts';
import { isRecord } from '../../../kit/coercion.ts';
import { buildTuiRuntimeConfig } from './tui-runtime-config.ts';
import type { PersistSnapshotMeta } from './snapshot.ts';

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

  // Configuration bundles (paths, recovery sources, stale probe policy) are
  // built up-front because they do not depend on the orchestrator. The
  // buffered event queue and refresh orchestrator form a small circular
  // dependency (queue calls back into `mergeEventState`, refresh owns
  // `mergeEventState`), so we wire them after the rest of the config lands.
  // The queue is created with a forward-reference handler that the refresh
  // bundle below resolves to the real `mergeEventState`.
  let mergeEventStateFn: ((event: unknown) => Promise<void>) | undefined;

  const config = buildTuiRuntimeConfig(api, options, async (event) => {
    if (mergeEventStateFn) await mergeEventStateFn(event);
  });
  const { statePath, persistQueuedSnapshot, recoverySources, staleRunningProbePolicy, bufferedEvents } = config;

  let disposed = false;
  let lastEventType: string | undefined;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let clockTickerDispose: (() => void) | undefined;

  // Slot-visibility gate: useSlotVisibility's Accessor takes priority when
  // provided; otherwise fall back to an internal boolean (tests/compat).
  let internalSlotVisible = false;
  const isSlotVisible = (): boolean => (input.isSlotVisible ? input.isSlotVisible() : internalSlotVisible);
  const setSlotVisible = (visible: boolean): void => {
    internalSlotVisible = visible;
  };
  const hasVisibleContent = input.hasVisibleContent ?? (() => true);

  let sessionScope: ReturnType<typeof createRuntimeSessionScopeHelpers> | undefined;

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

  const publishState = (nextState: SubagentState): void => {
    if (disposed) return;
    input.setState(nextState);
  };

  sessionScope = createRuntimeSessionScopeHelpers({
    getSessionId: input.getSessionId,
    setSessionId: input.setSessionId,
    syncState,
    createRefreshMeta: () => createPersistMeta('refresh'),
  });

  const refreshBundle = createTuiRuntimeRefresh(api, {
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
    publishState,
    isDisposed: () => disposed,
  });
  mergeEventStateFn = refreshBundle.mergeEventState;
  const refreshFn = refreshBundle.refresh;

  const refresh = async (sessionId: string = input.getSessionId()): Promise<void> => {
    await refreshFn(sessionId);
  };

  const refreshFromSlot = (slotInput: unknown): void => {
    const transition = resolveSessionSlotTransition(
      input.getSessionId(),
      slotInput,
      Object.keys(input.getState().children).length > 0,
    );

    if (!transition.nextSessionId) {
      if (transition.resetState) {
        sessionScope!.resetSessionScope();
      }
      return;
    }

    if (transition.resetState) {
      sessionScope!.beginSessionScope(transition.nextSessionId);
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
        markHardStaleRunningChildren(loadedState, staleRunningProbePolicy.hardStaleAfterMs);
        await syncState(loadedState, createPersistMeta('load'));
      }

      debugLog(`[subagent-status] bootstrap: calling refresh with sessionId=${input.getSessionId()}`);
      await refresh(input.getSessionId());
    } catch (e) {
      // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
      // single grep on `sessionId=` correlates every bootstrap failure to
      // its session — bootstrap is the most important lifecycle event.
      console.warn(
        '[agent-monitor] Bootstrap failed — sessionId=',
        input.getSessionId(),
        ':',
        e instanceof Error ? e : String(e),
      );
    } finally {
      await bufferedEvents.markReady();
      sessionScope!.finishStartupScopedEventBuffering();
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
