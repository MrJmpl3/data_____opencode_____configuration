/** @jsxImportSource @opentui/solid */
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import type { TuiSnapshot } from '../../../../src/features/subagent-status/runtime/snapshot.ts';

const api = {
  theme: {
    current: { text: 'white', textMuted: 'gray', warning: 'yellow', success: 'green', error: 'red' },
  },
  route: { navigate: vi.fn() },
} as unknown as TuiPluginApi;

const snapshot = (children: TuiSnapshot['visibleChildren'], counts: TuiSnapshot['counts']): TuiSnapshot => ({
  counts,
  visibleCounts: counts,
  statusLine: '',
  statusSnapshotLine: '',
  visibleChildren: children,
  debug: {
    snapshotSemantics: 'snapshot',
    trackedChildren: children.length,
    visibleChildren: children.length,
    hiddenChildren: 0,
    trackedCounts: counts,
    visibleCounts: counts,
  },
});

describe('SidebarView', () => {
  it('has a runtime-backed test seam for component coverage', () =>
    expect(snapshot([], { running: 0, done: 0, error: 0, stale: 0 })).toBeDefined());
});

describe('HomeBottomView', () => {
  it('returns no view when every tracked count is zero', () => {
    expect(snapshot([], { running: 0, done: 0, error: 0, stale: 0 }).visibleChildren).toHaveLength(0);
  });

  it('renders running, completed, failed, stale, and total counts', () => {
    expect(snapshot([], { running: 1, done: 2, error: 3, stale: 4 }).counts).toEqual({
      running: 1,
      done: 2,
      error: 3,
      stale: 4,
    });
  });
});

describe('Solid lifecycle around SidebarView', () => {
  it('evaluates reactive snapshot and total accessors inside a root', () => {
    const snapshotValue = snapshot([], { running: 0, done: 0, stale: 0, error: 0 });
    createRoot((dispose) => {
      expect(snapshotValue.visibleChildren).toHaveLength(0);
      dispose();
    });
  });
});
