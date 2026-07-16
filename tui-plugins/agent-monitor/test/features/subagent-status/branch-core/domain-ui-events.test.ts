import { describe, expect, it } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { normalizeChildrenResponse } from '../../../../src/features/subagent-status/domain/reconcile/normalize.ts';
import {
  collapseSubagentWorkItems,
  formatAggregateNumber,
  isVisibleWorkItem,
  visibleSubagentWorkItems,
} from '../../../../src/features/subagent-status/ui/collapse.ts';
import {
  formatContextCompact,
  formatDuration,
  formatRelativeRecency,
  formatSidebarCompactCount,
  formatSidebarRunningMeta,
  formatSidebarSectionHeading,
  formatSidebarTerminalMeta,
  formatSidebarTitle,
  formatTokenCompact,
  statusColor,
  truncateLabel,
} from '../../../../src/features/subagent-status/ui/format.ts';
import {
  buildToolChild,
  extractChildCore,
  extractCreatedChild,
  extractSubtaskChild,
  extractTaskToolEvidence,
  extractToolChild,
  validateToolPart,
} from '../../../../src/features/subagent-status/runtime/events/extract-child.ts';
import { applySubagentEvent } from '../../../../src/features/subagent-status/runtime/events/handle.ts';
import {
  analyzeMessages,
  createTuiMessageActivityCache,
  sessionStatusEndedAt,
} from '../../../../src/features/subagent-status/runtime/refresh/message-activity.ts';
import { createChild } from '../fixtures/subagent-state.ts';

const parent = 'ses_parent';
const session = (overrides: Partial<ReturnType<typeof createChild>> = {}) =>
  createChild({ id: 'ses_child', title: 'Build feature', parentID: parent, source: 'session', ...overrides });

describe('branch-core normalization and presentation', () => {
  it('rejects malformed responses and children while normalizing fallback fields', () => {
    expect(normalizeChildrenResponse(null)).toEqual([]);
    expect(normalizeChildrenResponse({ data: 'bad' })).toEqual([]);
    expect(normalizeChildrenResponse({ data: [{ id: 'missing-parent' }, { parentID: parent }, 1, null] })).toEqual([]);

    const [child] = normalizeChildrenResponse({
      data: [
        {
          id: 'ses_fallback',
          parentID: parent,
          name: 'Fallback name',
          status: 'failed',
          time: { created: 1_700_000_000, updated: 1_700_000_100 },
          tokens: { input: 2, output: Infinity, total: 4, contextPercent: 25 },
        },
      ],
    });
    expect(child).toMatchObject({
      title: 'Fallback name',
      status: 'error',
      source: 'session',
      targetSessionID: 'ses_fallback',
      startedAt: '2023-11-14T22:13:20.000Z',
      updatedAt: '2023-11-14T22:15:00.000Z',
      endedAt: '2023-11-14T22:15:00.000Z',
      tokens: { input: 2, total: 4, contextPercent: 25 },
    });
  });

  it('covers title, source, timestamp, status, and token fallbacks', () => {
    const [child] = normalizeChildrenResponse({
      id: 'not-an-array',
    });
    expect(child).toBeUndefined();
    const [running] = normalizeChildrenResponse({
      data: [
        {
          id: 'work',
          parentID: parent,
          source: 'subtask',
          state: 'busy',
          title: '',
          startedAt: '2026-01-01T00:00:00.000Z',
          tokens: { input: 'bad', output: null, total: NaN, contextPercent: undefined },
        },
      ],
    });
    expect(running).toMatchObject({
      title: 'Subagent',
      source: 'subtask',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(running?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(running?.tokens).toBeUndefined();
  });

  it('formats recency, durations, labels, counts, usage, and colors at boundaries', () => {
    const now = Date.parse('2026-06-05T12:00:00.000Z');
    expect(formatRelativeRecency(undefined, now)).toBe('');
    expect(formatRelativeRecency('bad', now)).toBe('');
    expect(formatRelativeRecency('2026-06-05T12:00:03.000Z', now)).toBe('now');
    expect(formatRelativeRecency('2026-06-05T11:59:30.000Z', now)).toBe('30s ago');
    expect(formatRelativeRecency('2026-06-05T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatRelativeRecency('2026-06-05T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeRecency('2026-06-02T12:00:00.000Z', now)).toBe('3d ago');
    expect(formatDuration(undefined)).toBe('00:00');
    expect(formatDuration(-1)).toBe('00:00');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
    expect(truncateLabel('  a   long label  ', 0)).toBe('');
    expect(truncateLabel('  a   long label  ', 1)).toBe('…');
    expect(truncateLabel('  a   long label  ', 6)).toBe('a lon…');
    expect(formatAggregateNumber(-3.2)).toBe('0');
    expect(formatSidebarCompactCount(NaN)).toBe('0');
    expect(formatSidebarCompactCount(Infinity)).toBe('999T+');
    expect(formatSidebarCompactCount(-Infinity)).toBe('0');
    expect(formatSidebarCompactCount(999)).toBe('999');
    expect(formatSidebarCompactCount(1_500)).toBe('1.5k');
    expect(formatSidebarCompactCount(100_000)).toBe('100k');
    expect(formatSidebarCompactCount(1_500_000)).toBe('1.5M');
    expect(formatSidebarCompactCount(1_500_000_000)).toBe('1.5B');
    expect(formatSidebarCompactCount(1_500_000_000_000)).toBe('1.5T');
    expect(formatSidebarCompactCount(1_000_000_000_000_000)).toBe('999T+');
    expect(formatSidebarSectionHeading('A very long section heading', 2)).toBe('A very long section heading ·…');
    expect(formatSidebarTitle(session({ summary: ' Summary text ' }), true)).toBe('Summary text');
    expect(formatSidebarTitle(session({ summary: '   ', title: '' }), false)).toBe('ses_child');
    expect(formatTokenCompact(session({ tokens: { total: 1_500_000 } }))).toBe('1.5M tok');
    expect(formatTokenCompact(session())).toBe('');
    expect(formatContextCompact(session({ tokens: { contextPercent: 12.6 } }))).toBe('13%');
    expect(formatContextCompact(session())).toBe('');
    expect(
      formatSidebarRunningMeta(session({ elapsedMs: 61_000, agentName: '  planner ', tokens: { total: 12 } })),
    ).toContain('@planner');
    expect(formatSidebarTerminalMeta(session({ status: 'done', endedAt: '2026-06-05T11:59:00.000Z' }), now)).toContain(
      '1m ago',
    );
    expect(statusColor('done')).toBe('green');
    expect(statusColor('error')).toBe('red');
    expect(statusColor('stale')).toBe('red');
    expect(statusColor('running')).toBe('yellow');
  });

  it('collapses matching synthetic work and preserves unmatched visibility rules', () => {
    const real = session({
      agentName: 'planner',
      title: 'Implement API (subtask)',
      status: 'done',
      endedAt: '2026-06-05T11:59:00.000Z',
    });
    const matched = createChild({
      id: 'subtask:1',
      title: 'Implement API',
      parentID: parent,
      source: 'subtask',
      agentName: 'planner',
      messageID: 'm1',
    });
    const generic = createChild({ id: 'tool:delegate', title: 'delegate', parentID: parent, source: 'tool' });
    const tool = createChild({
      id: 'tool:real',
      title: 'Implement API details',
      parentID: parent,
      source: 'tool',
      summary: 'same',
    });
    const duplicate = createChild({
      id: 'tool:duplicate',
      title: 'Implement API details',
      parentID: parent,
      source: 'tool',
      summary: 'same',
    });
    const collapsed = collapseSubagentWorkItems([real, matched, generic, tool, duplicate]);
    expect(collapsed.find((child) => child.id === 'subtask:1')).toMatchObject({
      status: 'done',
      targetSessionID: real.id,
    });
    expect(collapsed.find((child) => child.id === real.id)).toBeUndefined();
    expect(collapsed.find((child) => child.id === generic.id)).toBeUndefined();
    expect(collapsed.find((child) => child.id === duplicate.id)).toBeUndefined();
    expect(
      isVisibleWorkItem(
        createChild({ id: 'done', title: 'Done', parentID: parent, status: 'done', endedAt: 'bad' }),
        Date.now(),
      ),
    ).toBe(false);
    expect(
      isVisibleWorkItem(
        createChild({ id: 'old', title: 'Old', parentID: parent, status: 'done', endedAt: '2026-01-01T00:00:00.000Z' }),
        Date.parse('2026-06-05T00:00:00.000Z'),
        { doneRetentionMs: 1000, staleRetentionMs: 1 },
      ),
    ).toBe(false);
    const active = createChild({
      id: 'active',
      title: 'Active',
      parentID: parent,
      messageID: 'active',
      status: 'running',
    });
    const unrelatedDone = createChild({
      id: 'done2',
      title: 'Done',
      parentID: parent,
      messageID: 'other',
      status: 'done',
      endedAt: '2026-06-05T11:59:00.000Z',
    });
    expect(visibleSubagentWorkItems([active, unrelatedDone], Date.parse('2026-06-05T12:00:00.000Z'))).toEqual([active]);
  });
});

describe('branch-core message activity and event extraction', () => {
  it('chooses timestamp precedence and terminal evidence across messages and parts', () => {
    const activity = analyzeMessages([
      {
        type: 'step-start',
        time: { start: '2026-06-05T12:01:00.000Z' },
        parts: [{ type: 'step-finish', reason: 'stop', time: { completed: '2026-06-05T12:02:00.000Z' } }],
      },
      { type: 'session.status', status: 'completed', time: { completed: '2026-06-05T12:03:00.000Z' } },
      { type: 'completed', status: 'completed', time: { completed: '2026-06-05T12:04:00.000Z' } },
      { type: 'session.status', status: 'error', time: { ended: '2026-06-05T12:05:00.000Z' } },
    ]);
    expect(activity.summary).toEqual({ status: 'error', endedAt: '2026-06-05T12:05:00.000Z' });
    expect(activity.latestLiveActivityAt).toBe('2026-06-05T12:01:00.000Z');
    expect(
      analyzeMessages([{ type: 'step-finish', reason: 'stop', time: { completed: '2026-06-05T12:00:00.000Z' } }])
        .summary,
    ).toMatchObject({ status: 'done', endedAt: '2026-06-05T12:00:00.000Z' });
    expect(
      analyzeMessages([
        { type: 'step-finish', reason: 'stop', time: { completed: '2026-06-05T12:00:00.000Z' } },
        { type: 'step-start', time: { start: '2026-06-05T12:01:00.000Z' } },
      ]).summary,
    ).toEqual({});
    expect(
      analyzeMessages([{ type: 'step-finish', reason: 'stop', time: { completed: '2026-06-05T12:00:00.000Z' } }])
        .latestActivityAt,
    ).toBe('2026-06-05T12:00:00.000Z');
    expect(sessionStatusEndedAt({ time: { completed: 1_700_000_000 } })).toBe('2023-11-14T22:13:20.000Z');
    expect(sessionStatusEndedAt({ time: { updated: '2026-01-01T00:00:00.000Z' } })).toBe('2026-01-01T00:00:00.000Z');
    expect(sessionStatusEndedAt('bad')).toBeUndefined();
  });

  it('caches TUI activity and tolerates message read failures', () => {
    const messages = {
      messages: (id: string) =>
        id === 'bad'
          ? (() => {
              throw new Error('no messages');
            })()
          : [{ time: { updated: '2026-01-01T00:00:00.000Z' } }],
    };
    const cache = createTuiMessageActivityCache({ state: { session: messages } } as never);
    expect(cache('ok')).toBe(cache('ok'));
    expect(cache('bad')).toEqual({ summary: {} });
  });

  it('extracts valid children and rejects malformed event parts', () => {
    expect(extractChildCore({ properties: { info: { id: 'ses_child' } } } as never)).toBeNull();
    const created = extractCreatedChild({
      type: 'session.created',
      properties: { info: { id: 'ses_child', parentID: parent, name: 'Child', status: 'busy' } },
    } as never);
    expect(created).toMatchObject({ id: 'ses_child', status: 'running', title: 'Child' });
    expect(extractSubtaskChild({ properties: { part: { type: 'tool' } } } as never)).toBeNull();
    expect(
      extractSubtaskChild({ properties: { part: { type: 'subtask', id: 'p', sessionID: parent } } } as never),
    ).toBeNull();
    expect(
      extractTaskToolEvidence({ properties: { part: { type: 'tool', tool: 'bash', state: {} } } } as never),
    ).toBeNull();
    expect(
      extractTaskToolEvidence({
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            state: {
              status: 'failed',
              metadata: { session_id: 'ses_child' },
              time: { end: '2026-01-01T00:00:00.000Z' },
            },
          },
        },
      } as never),
    ).toMatchObject({ status: 'error', targetSessionID: 'ses_child' });
    expect(validateToolPart({ properties: { part: { type: 'tool', tool: 'bash' } } } as never)).toBeNull();
    const validated = validateToolPart({
      properties: {
        sessionID: parent,
        part: { type: 'tool', tool: 'delegate', id: 'p', messageID: 'm', state: { input: { prompt: 'Do it' } } },
      },
    } as never);
    expect(validated).not.toBeNull();
    expect(
      buildToolChild(
        {
          properties: {
            sessionID: parent,
            part: { type: 'tool', tool: 'delegate', id: 'p', messageID: 'm', state: { input: { prompt: 'Do it' } } },
          },
        } as never,
        validated!,
      ),
    ).toMatchObject({ id: 'tool:p', title: 'Do it', status: 'running' });
    expect(extractToolChild({ properties: { part: { type: 'not-tool' } } } as never)).toBeNull();
  });

  it('applies malformed and session state-machine events through the public handler', () => {
    const state = createEmptyState();
    expect(applySubagentEvent(state, null)).toBe(false);
    expect(applySubagentEvent(state, { type: 'irrelevant' })).toBe(false);
    expect(
      applySubagentEvent(state, {
        type: 'session.created',
        properties: { info: { id: 'ses_child', parentID: parent } },
      }),
    ).toBe(true);
    expect(
      applySubagentEvent(state, { type: 'session.idle', properties: { sessionID: 'ses_child', status: 'completed' } }),
    ).toBe(true);
    expect(state.children.ses_child?.status).toBe('done');
    expect(
      applySubagentEvent(state, {
        type: 'session.updated',
        properties: { sessionID: 'ses_child', info: { id: 'ses_child', parentID: parent } },
      }),
    ).toBe(false);
    expect(applySubagentEvent(state, { type: 'session.error', properties: { sessionID: 'ses_child' } })).toBe(true);
  });
});
