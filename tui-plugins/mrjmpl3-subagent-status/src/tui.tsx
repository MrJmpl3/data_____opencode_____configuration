/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiPluginModule, TuiThemeCurrent } from '@opencode-ai/plugin/tui';
import { For, Show, createMemo, createRoot, createSignal } from 'solid-js';

import { formatContextCompact, formatDuration, statusColor as resolveRenderStatusColor } from './render.ts';
import { createTuiRuntime } from './refresh.ts';
import { buildTuiSnapshot } from './snapshot.ts';
import { createEmptyState } from './state.ts';
import { navigateToChildSession, resolveNavigationSessionID } from './session.ts';
import type { SubagentChild, SubagentState } from './types.ts';

const PLUGIN_ID = 'mrjmpl3-subagent-status';
const CLOCK_ICON = '';
const TOKEN_ICON = '';
const SIDEBAR_ARROW_EXPANDED = '▼';
const SIDEBAR_ARROW_COLLAPSED = '▶';

function taskStatusMarker(status: SubagentChild['status']): string {
  if (status === 'done') return '[✓]';
  if (status === 'error') return '[x]';
  return '[ ]';
}

function themeStatusColor(
  status: SubagentChild['status'],
  theme: Pick<TuiThemeCurrent, 'success' | 'error' | 'warning'>,
): TuiThemeCurrent['success'] {
  if (resolveRenderStatusColor(status) === 'green') return theme.success;
  if (resolveRenderStatusColor(status) === 'red') return theme.error;
  return theme.warning;
}

function formatChildTitle(child: SubagentChild): string {
  const base = child.summary?.trim() || child.title?.trim() || child.id || 'Subagent';
  return child.agentName ? `${base} (${child.agentName})` : base;
}

const plugin: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui: async (api: TuiPluginApi) => {
    createRoot((disposeRoot) => {
      const { slots } = api;
      const [state, setState] = createSignal<SubagentState>(createEmptyState());
      const [sessionId, setSessionId] = createSignal('');
      const [expanded, setExpanded] = createSignal(true);
      const [nowMs, setNowMs] = createSignal(Date.now());
      const snapshot = createMemo(() => buildTuiSnapshot(state(), nowMs()));
      const runtime = createTuiRuntime(api, {
        getState: state,
        setState,
        getSessionId: sessionId,
        setSessionId,
        setNowMs,
      });

      api.lifecycle.onDispose(() => {
        runtime.dispose();
        disposeRoot();
      });

      const ChildRow = (props: { child: SubagentChild }) => {
        const clickable = createMemo(() => resolveNavigationSessionID(props.child) !== undefined);
        const opacity = createMemo(() => (props.child.status === 'running' ? 1 : 0.68));
        const label = createMemo(() => formatChildTitle(props.child));
        const elapsed = createMemo(() => formatDuration(props.child.elapsedMs));
        const meta = createMemo(() => formatContextCompact(props.child));

        return (
          <box
            flexDirection="column"
            opacity={opacity()}
            onMouseUp={
              clickable()
                ? () => {
                    navigateToChildSession(api, props.child);
                  }
                : undefined
            }
          >
            <box flexDirection="row">
              <text fg={themeStatusColor(props.child.status, api.theme.current)}>
                {taskStatusMarker(props.child.status)}
              </text>
              <text fg={api.theme.current.text}>{` ${label()}`}</text>
            </box>

            <Show
              when={props.child.status === 'running'}
              fallback={
                <box flexDirection="row" paddingLeft={4}>
                  <text fg={api.theme.current.textMuted}>{`↳ ${CLOCK_ICON} ${elapsed()}`}</text>
                  <Show when={meta().length > 0}>
                    <text fg={api.theme.current.textMuted}>{` ${TOKEN_ICON} ${meta()}`}</text>
                  </Show>
                </box>
              }
            >
              <box flexDirection="column">
                <text fg={api.theme.current.textMuted}>{`    ↳ ${CLOCK_ICON} ${elapsed()}`}</text>
                <Show when={meta().length > 0}>
                  <text fg={api.theme.current.textMuted}>{`    ${TOKEN_ICON} ${meta()}`}</text>
                </Show>
              </box>
            </Show>
          </box>
        );
      };

      slots.register({
        order: 120,
        slots: {
          sidebar_content: (_ctx: unknown, slotInput: unknown) => {
            runtime.refreshFromSlot(slotInput);
            const currentSnapshot = snapshot();
            const counts = currentSnapshot.counts;

            return (
              <box flexDirection="column">
                <box flexDirection="row">
                  <text
                    fg={api.theme.current.text}
                    selectable={false}
                    onMouseDown={() => setExpanded((value) => !value)}
                  >
                    {`${expanded() ? SIDEBAR_ARROW_EXPANDED : SIDEBAR_ARROW_COLLAPSED} Subagents`}
                  </text>
                </box>
                <box flexDirection="row" paddingRight={1}>
                  <text fg={api.theme.current.warning}>{`● ${counts.running} run`}</text>
                  <text fg={api.theme.current.textMuted}> · </text>
                  <text fg={api.theme.current.success}>{`✓ ${counts.done} done`}</text>
                  <text fg={api.theme.current.textMuted}> · </text>
                  <text fg={api.theme.current.error}>{`✕ ${counts.error} err`}</text>
                  <text fg={api.theme.current.textMuted}> · </text>
                  <text fg={api.theme.current.text}>{`Σ ${state().totalExecuted}`}</text>
                </box>

                <Show when={expanded()}>
                  <box flexDirection="column">
                    <Show
                      when={currentSnapshot.visibleChildren.length > 0}
                      fallback={<text fg={api.theme.current.textMuted}>No subagents yet</text>}
                    >
                      <For each={currentSnapshot.visibleChildren}>{(child) => <ChildRow child={child} />}</For>
                    </Show>
                  </box>
                </Show>
              </box>
            );
          },
          home_bottom: () => {
            const counts = snapshot().counts;
            if (counts.running + counts.done + counts.error === 0) return undefined;

            return (
              <box paddingLeft={1} paddingRight={1}>
                <box flexDirection="row">
                  <text fg={api.theme.current.warning}>{`● ${counts.running}`}</text>
                  <text fg={api.theme.current.textMuted}> · </text>
                  <text fg={api.theme.current.success}>{`✓ ${counts.done}`}</text>
                  <text fg={api.theme.current.textMuted}> · </text>
                  <text fg={api.theme.current.error}>{`✕ ${counts.error}`}</text>
                  <text fg={api.theme.current.textMuted}> · </text>
                  <text fg={api.theme.current.text}>{`Σ ${state().totalExecuted}`}</text>
                </box>
              </box>
            );
          },
        },
      });

      void runtime.bootstrap();
    });
  },
};

export default plugin;

export { buildTuiSnapshot, elapsedMs } from './snapshot.ts';
