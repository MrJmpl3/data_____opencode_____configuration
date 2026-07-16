import { describe, expect, it } from 'vitest';

import {
  getCounts,
  resolveElapsedMs,
  resolveSessionIdentity,
  sanitizeAgentName,
  sanitizeSummary,
  sanitizeTargetSessionID,
} from '../../../../src/features/subagent-status/domain/state/core.ts';
import {
  normalizeChild,
  pruneOrphanedSyntheticRunningChildren,
  rekeyCountedExecution,
  resolveExecutionCountIdentity,
} from '../../../../src/features/subagent-status/domain/state/maintenance.ts';
import { upsertChildDetails } from '../../../../src/features/subagent-status/domain/state/mutate-details.ts';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import {
  reconcileChildrenState,
  selectLatestTerminalEvidence,
} from '../../../../src/features/subagent-status/domain/reconcile/reconcile.ts';
import { normalizeChildrenResponse } from '../../../../src/features/subagent-status/domain/reconcile/normalize.ts';
import type { SubagentChild } from '../../../../src/features/subagent-status/domain/types.ts';

const child = (overrides: Partial<SubagentChild> & Pick<SubagentChild, 'id'>): SubagentChild => ({
  ...overrides,
  id: overrides.id,
  title: overrides.title ?? overrides.id,
  parentID: overrides.parentID ?? 'ses_parent',
  status: overrides.status ?? 'running',
  startedAt: overrides.startedAt ?? '2026-06-04T12:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-06-04T12:01:00.000Z',
});

describe('final domain recovery boundaries', () => {
  it('rejects empty or title-only display values and validates session identity fallbacks', () => {
    expect(sanitizeSummary('  Same\n title ', 'same title')).toBeUndefined();
    expect(sanitizeSummary('  useful\n detail ', 'Title')).toBe('useful detail');
    expect(sanitizeAgentName('( worker )')).toBe('worker');
    expect(sanitizeAgentName('   ')).toBeUndefined();
    expect(sanitizeTargetSessionID('bad', 'ses_fallback')).toBe('ses_fallback');
    expect(sanitizeTargetSessionID('bad', 'also-bad')).toBeUndefined();
    expect(resolveSessionIdentity({ id: 'ses_direct', targetSessionID: 'ses_other' })).toBe('ses_direct');
    expect(resolveSessionIdentity({ id: 'task', targetSessionID: 'bad' })).toBeUndefined();
  });

  it('handles malformed elapsed timestamps and all status counters', () => {
    expect(resolveElapsedMs(child({ id: 'bad', startedAt: 'bad' }), Date.now())).toBe(0);
    expect(
      resolveElapsedMs(
        child({ id: 'bad', startedAt: '2026-06-04T12:01:00.000Z', status: 'running' }),
        Date.parse('2026-06-04T12:00:00.000Z'),
      ),
    ).toBe(0);
    expect(
      resolveElapsedMs(
        child({ id: 'bad', startedAt: '2026-06-04T12:00:00.000Z', status: 'done', endedAt: 'bad' }),
        Date.now(),
      ),
    ).toBe(0);
    const state = createEmptyState();
    state.children = {
      running: child({ id: 'running' }),
      done: child({ id: 'done', status: 'done' }),
      stale: child({ id: 'stale', status: 'stale' }),
      error: child({ id: 'error', status: 'error' }),
    };
    expect(getCounts(state)).toEqual({ running: 1, done: 1, stale: 1, error: 1 });
  });

  it('normalizes invalid persisted children and preserves valid detail precedence', () => {
    const normalized = normalizeChild(
      child({ id: 'ses_child', title: '', status: 'unknown' as never, startedAt: 'bad' }),
      Date.parse('2026-06-04T12:00:00.000Z'),
    );
    expect(normalized).toMatchObject({ title: 'ses_child', status: 'running', color: 'yellow' });
    const state = createEmptyState();
    state.children.ses_child = child({
      id: 'ses_child',
      title: 'Original',
      summary: 'Original summary',
      tokens: { input: 2 },
    });
    expect(upsertChildDetails(state, 'missing', { title: 'ignored' })).toBe(false);
    expect(
      upsertChildDetails(state, 'ses_child', {
        summary: 'Original',
        tokens: { output: 3 },
        targetSessionID: 'invalid',
      }),
    ).toBe(true);
    expect(state.children.ses_child).toMatchObject({
      summary: 'Original summary',
      tokens: { input: 2, output: 3 },
      targetSessionID: 'ses_child',
    });
  });

  it('resolves duplicate execution identities and rejects ambiguous correlations', () => {
    const state = createEmptyState();
    state.children = {
      first: child({ id: 'first', source: 'session', messageID: 'm' }),
      second: child({ id: 'second', source: 'session', messageID: 'm' }),
    };
    state.countedChildIDs = { first: true, second: true };
    expect(
      resolveExecutionCountIdentity(state, {
        id: 'subtask',
        title: 'work',
        parentID: 'ses_parent',
        source: 'subtask',
        messageID: 'm',
      }),
    ).toBe('subtask');
    expect(rekeyCountedExecution(state, 'missing', 'new')).toBe(false);
    expect(rekeyCountedExecution(state, 'first', 'second')).toBe(true);
  });

  it('prunes synthetic rows only when their active session anchor is absent', () => {
    const state = createEmptyState();
    state.children.tool = child({ id: 'tool', source: 'tool', parentID: 'ses_parent' });
    state.children.subtask = child({ id: 'subtask', source: 'subtask', parentID: 'ses_parent' });
    expect(pruneOrphanedSyntheticRunningChildren(state)).toBe(true);
    expect(state.children.subtask).toBeDefined();
    state.children.ses_active = child({ id: 'ses_active', source: 'session', status: 'done' });
    expect(pruneOrphanedSyntheticRunningChildren(state, { pruneWhenNoRealSessionChildren: true })).toBe(true);
  });

  it('normalizes malformed responses and chooses the newest terminal evidence deterministically', () => {
    expect(normalizeChildrenResponse({ data: [null, {}, { id: 'ok', parentID: 'p' }] })).toHaveLength(1);
    const older = child({
      id: 'tool:a',
      targetSessionID: 'ses_x',
      source: 'tool',
      status: 'done',
      endedAt: '2026-06-04T12:01:00.000Z',
    });
    const newer = child({
      id: 'tool:z',
      targetSessionID: 'ses_x',
      source: 'tool',
      status: 'error',
      endedAt: '2026-06-04T12:02:00.000Z',
    });
    expect(selectLatestTerminalEvidence([older, newer]).get('ses_x')?.id).toBe('tool:z');
    expect(
      reconcileChildrenState(createEmptyState(), { data: [{ id: 'ses_x', parentID: 'p', title: 'x', status: 'done' }] })
        .changed,
    ).toBe(true);
  });
});
