/** @jsxImportSource @opentui/solid */
import { describe, expect, it, vi } from 'vitest';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { SidebarView, HomeBottomView } from '../../../../src/features/subagent-status/ui/view.tsx';
import type { TuiSnapshot } from '../../../../src/features/subagent-status/runtime/snapshot.ts';
import { createChild } from '../fixtures/subagent-state.ts';
import { memoryElements, memoryText, renderMemory, type MemoryNode } from '../../../support/opentui-memory-renderer.ts';

const theme = { text: 'white', textMuted: 'gray', warning: 'yellow', success: 'green', error: 'red' };
const api = { theme: { current: theme }, route: { navigate: vi.fn() } } as unknown as TuiPluginApi;

const snapshot = (visibleChildren: TuiSnapshot['visibleChildren'], counts: TuiSnapshot['counts']): TuiSnapshot => ({
  counts,
  visibleCounts: counts,
  statusLine: '',
  statusSnapshotLine: '',
  visibleChildren,
  debug: {
    snapshotSemantics: 'snapshot',
    trackedChildren: visibleChildren.length,
    visibleChildren: visibleChildren.length,
    hiddenChildren: 0,
    trackedCounts: counts,
    visibleCounts: counts,
  },
});

const renderView = (view: () => unknown): { root: MemoryNode; dispose: () => void } =>
  renderMemory(view as () => MemoryNode);

describe('rendered subagent status views', () => {
  it('renders a collapsed sidebar with aggregate status counts only', () => {
    const child = createChild({ id: 'ses_running', title: 'Build feature', parentID: 'ses_parent', status: 'running' });
    const rendered = renderView(() => (
      <SidebarView
        api={api}
        snapshot={() => snapshot([child], { running: 1, done: 0, error: 0, stale: 0 })}
        totalExecuted={() => 4}
        expanded={false}
        onToggle={vi.fn()}
      />
    ));

    expect(memoryText(rendered.root)).toContain('▶ Subagents · Σ 4');
    expect(memoryText(rendered.root)).toContain('● 1 ✓ 0 ✕ 0');
    expect(memoryText(rendered.root)).not.toContain('Build feature');
    expect(memoryElements(rendered.root, 'box')).toHaveLength(3);
    rendered.dispose();
  });

  it('renders an expanded empty sidebar and toggles from the header interaction', () => {
    const onToggle = vi.fn();
    const rendered = renderView(() => (
      <SidebarView
        api={api}
        snapshot={() => snapshot([], { running: 0, done: 0, error: 0, stale: 0 })}
        totalExecuted={() => 0}
        expanded
        onToggle={onToggle}
      />
    ));

    expect(memoryText(rendered.root)).toContain('▼ Subagents · Σ 0');
    expect(memoryText(rendered.root)).toContain('No subagents yet');
    const texts = memoryElements(rendered.root, 'text');
    const header = texts.find((node) => memoryText(node).includes('Subagents'));
    expect(header?.props.onMouseDown).toBe(onToggle);
    (header?.props.onMouseDown as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
    rendered.dispose();
  });

  it('renders mixed active and recent rows with metadata, styling, and navigation', () => {
    const navigate = vi.fn();
    const running = createChild({
      id: 'ses_running',
      title: 'Implement sidebar synchronization',
      summary: 'Sync sidebar',
      parentID: 'ses_parent',
      status: 'running',
      elapsedMs: 125000,
      agentName: 'planner',
      tokens: { total: 420, contextPercent: 58 },
    });
    const done = createChild({
      id: 'ses_done',
      title: 'Complete tests',
      parentID: 'ses_parent',
      status: 'done',
      endedAt: '2026-06-04T11:59:00.000Z',
      elapsedMs: 60000,
      tokens: { total: 64 },
    });
    const error = createChild({
      id: 'tool:error',
      title: 'Failed tool',
      parentID: 'ses_parent',
      status: 'error',
      elapsedMs: 3000,
    });
    const rendered = renderView(() => (
      <SidebarView
        api={api}
        snapshot={() => snapshot([running, done, error], { running: 1, done: 1, error: 1, stale: 0 })}
        totalExecuted={() => 3}
        expanded
        onToggle={vi.fn()}
        onNavigateToChild={navigate}
      />
    ));

    const text = memoryText(rendered.root);
    expect(text).toContain('Active · 1');
    expect(text).toContain('Recent · 2');
    expect(text).toContain('Sync sidebar');
    expect(text).toContain('02:05');
    expect(text).toContain('@planner');
    expect(text).toContain('420 58%');
    expect(text).toContain('✓ Complete tests');
    expect(text).toContain('✕ Failed tool');

    const rows = memoryElements(rendered.root, 'box').filter((node) => node.props.onMouseUp);
    expect(rows).toHaveLength(2);
    (rows[0]?.props.onMouseUp as () => void)();
    expect(navigate).toHaveBeenCalledWith({
      parentSessionID: 'ses_parent',
      childSessionID: 'ses_running',
      childRowID: 'ses_running',
    });
    expect(api.route.navigate).toHaveBeenCalledWith('session', { sessionID: 'ses_running' });
    expect(memoryElements(rendered.root, 'text').some((node) => node.props.fg === theme.success)).toBe(true);
    expect(memoryElements(rendered.root, 'text').some((node) => node.props.fg === theme.error)).toBe(true);
    rendered.dispose();
  });

  it('returns no home footer for empty state and renders all aggregate metadata for mixed state', () => {
    const empty = renderView(() => (
      <HomeBottomView
        api={api}
        snapshot={() => snapshot([], { running: 0, done: 0, error: 0, stale: 0 })}
        totalExecuted={() => 0}
      />
    ));
    expect(empty.root.children).toHaveLength(0);
    empty.dispose();

    const mixed = renderView(() => (
      <HomeBottomView
        api={api}
        snapshot={() => snapshot([], { running: 2, done: 1000, error: 3, stale: 4 })}
        totalExecuted={() => 1010}
      />
    ));
    expect(memoryText(mixed.root)).toBe('● 2 · ✓ 1,000 · ✕ 7 · Σ 1,010');
    expect(memoryElements(mixed.root, 'text').map((node) => node.props.fg)).toEqual([
      theme.warning,
      theme.textMuted,
      theme.success,
      theme.textMuted,
      theme.error,
      theme.textMuted,
      theme.text,
    ]);
    mixed.dispose();
  });
});
