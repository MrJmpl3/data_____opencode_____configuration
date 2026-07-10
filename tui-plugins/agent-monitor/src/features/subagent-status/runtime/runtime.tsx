/** @jsxImportSource @opentui/solid */
// Entry point del feature subagent-status. OpenCode llama esta funcion cuando
// monta el plugin. Registra los slots del sidebar, home y prompt, y arranca
// el runtime que procesa eventos de sesiones de subagentes.

import type { TuiPluginApi, TuiSlotContext } from '@opencode-ai/plugin/tui';
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';

import { useSlotVisibility } from '../../../kit/use-slot-visibility.ts';

import { createPromptFocusController } from './session/focus.ts';
import {
  normalizeHomePromptProps,
  normalizeSessionPromptProps,
  type HomePromptProps,
  type SessionPromptProps,
} from './prompt-props.ts';
import { createEmptyState } from '../domain/state/core.ts';
import type { SubagentState } from '../domain/types.ts';
import { buildTuiStructuralView, buildTimedSnapshot } from './snapshot.ts';
import { HomeBottomView, SidebarView } from '../ui/view.tsx';
import { normalizeSubagentStatusPluginOptions } from './options.ts';
import { createTuiRuntime } from './tui-runtime.ts';
import { resolveRouteSessionId } from './session/route-params.ts';
import { readSubagentStatusOptions } from '../infrastructure/config.ts';

export const registerSubagentStatusTui = async (api: TuiPluginApi, options: unknown): Promise<void> => {
  // ── Config resolution ─────────────────────────────────────────────
  // 1. agent-monitor.json es la fuente canónica (sections.subagent-status.options)
  // 2. Si no existe, cae al parámetro options (tui.json segundo elemento)
  // 3. Si ambos faltan, normalizeSubagentStatusPluginOptions aplica defaults
  const fileOptions = readSubagentStatusOptions();
  const mergedOptions = fileOptions !== undefined ? fileOptions : options;
  const resolvedOptions = normalizeSubagentStatusPluginOptions(mergedOptions);

  createRoot((disposeRoot) => {
    const { slots } = api;
    const [state, setState] = createSignal<SubagentState>(createEmptyState());
    const [sessionId, setSessionId] = createSignal('');
    const [expanded, setExpanded] = createSignal(true);
    const [nowMs, setNowMs] = createSignal(Date.now());
    // Structural view: sort, collapse, filter, count. Only recomputes when
    // the state tree changes (events, refresh), NOT on every 1Hz tick.
    const structuralView = createMemo(() => buildTuiStructuralView(state(), resolvedOptions.visibility));
    // Timed overlay: applies elapsedMs hydration to visible children on every
    // 1Hz tick. The expensive structural work stays cached in structuralView.
    const snapshot = createMemo(() => buildTimedSnapshot(structuralView(), nowMs()));
    const promptFocusController = createPromptFocusController();
    const { isVisible, SlotProvider } = useSlotVisibility(api);

    const runtime = createTuiRuntime(
      api,
      {
        getState: state,
        setState,
        getSessionId: sessionId,
        setSessionId,
        setNowMs,
        isSlotVisible: isVisible,
        // The clock's content gate: only tick while visible children exist.
        hasVisibleContent: () => snapshot().visibleChildren.length > 0,
      },
      resolvedOptions,
    );

    api.lifecycle.onDispose(() => {
      runtime.dispose();
      disposeRoot();
    });

    createEffect(() => {
      void api.route.current;
      promptFocusController.handleRouteChange(resolveRouteSessionId(api.route.current));
    });

    slots.register({
      order: 110,
      slots: {
        home_prompt: (_ctx: TuiSlotContext, props: HomePromptProps) => {
          const promptProps = normalizeHomePromptProps(props, promptFocusController.composePromptRef);
          return <api.ui.Prompt {...promptProps} />;
        },
        session_prompt: (_ctx: TuiSlotContext, props: SessionPromptProps) => {
          const nextSessionId = props.sessionID ?? props.session_id ?? props.sessionId;
          const promptProps = normalizeSessionPromptProps(
            props,
            promptFocusController.composePromptRef,
            nextSessionId ? <api.ui.Slot name="session_prompt_right" session_id={nextSessionId} /> : undefined,
          );
          return <api.ui.Prompt {...promptProps} />;
        },
        sidebar_content: (_ctx: unknown, slotInput: unknown) => {
          runtime.refreshFromSlot(slotInput);
          // Mark slot visible via useSlotVisibility — SlotProvider handles
          // visibility state and cleanup automatically.
          SlotProvider(_ctx, slotInput);

          return (
            <SidebarView
              api={api}
              snapshot={snapshot}
              totalExecuted={() => state().totalExecuted}
              expanded={expanded()}
              onToggle={() => setExpanded((value) => !value)}
              onNavigateToChild={promptFocusController.rememberSidebarChildNavigation}
            />
          );
        },
        home_bottom: () => <HomeBottomView api={api} snapshot={snapshot} totalExecuted={() => state().totalExecuted} />,
      },
    });

    void runtime.bootstrap();
  });
};
