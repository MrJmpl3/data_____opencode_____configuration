import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveRecoveredStatus,
  safeParseParts,
} from '../../../src/features/subagent-status/infrastructure/sqlite/recovery-classifier.ts';
import { createSQLiteRecoveryRowsReader } from '../../../src/features/subagent-status/infrastructure/sqlite/script.ts';
import { reconcileNormalizedChildrenState } from '../../../src/features/subagent-status/domain/reconcile/reconcile.ts';
import { collapseSubagentWorkItems, isVisibleWorkItem } from '../../../src/features/subagent-status/ui/collapse.ts';
import { formatRelativeRecency, truncateLabel } from '../../../src/features/subagent-status/ui/format.ts';
import type { SubagentChild, SubagentState } from '../../../src/features/subagent-status/domain/types.ts';

const child = (id: string, overrides: Partial<SubagentChild> = {}): SubagentChild => ({
  id,
  title: 'Task',
  parentID: 'parent',
  source: 'session',
  status: 'running',
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const state = (children: SubagentChild[]): SubagentState => ({
  children: Object.fromEntries(children.map((entry) => [entry.id, entry])),
  countedChildIDs: {},
  purgedSessionIDs: {},
  totalExecuted: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('subagent status boundary branches', () => {
  afterEach(() => vi.restoreAllMocks());

  it('classifies explicit, ambiguous, fallback, and running SQLite evidence', () => {
    expect(safeParseParts(['{"type":"step-start"}', '{bad'])).toEqual([{ type: 'step-start' }, undefined]);
    expect(resolveRecoveredStatus([]).status).toBe('running');
    expect(
      resolveRecoveredStatus([
        { type: 'session.error', time: { end: '2026-01-01T00:00:02.000Z' }, tokens: { output: 2 } },
      ]),
    ).toMatchObject({ status: 'error', evidence: 'explicit', tokens: { output: 2 } });
    expect(resolveRecoveredStatus([{ type: 'session.completed', state: { status: 'completed' } }])).toMatchObject({
      status: 'done',
      evidence: 'explicit',
    });
    expect(resolveRecoveredStatus([{ type: 'session.completed', state: { status: 'done' } }])).toMatchObject({
      status: 'done',
      evidence: 'explicit',
    });
    expect(
      resolveRecoveredStatus([{ type: 'step-finish', reason: 'stop', time: { end: '2026-01-01T00:00:02.000Z' } }]),
    ).toMatchObject({ status: 'done', evidence: 'ambiguous' });
    expect(resolveRecoveredStatus([{ type: 'step-start', time: { start: '2026-01-01T00:00:03.000Z' } }])).toMatchObject(
      {
        status: 'running',
      },
    );
  });

  it('reads SQLite rows, skips invalid sessions, and closes the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-final-'));
    const databasePath = join(directory, 'db.sqlite');
    writeFileSync(databasePath, 'db');
    const close = vi.fn();
    const reader = createSQLiteRecoveryRowsReader(
      () =>
        ({
          DatabaseSync: class {
            close = close;
            prepare(sql: string) {
              return {
                all: () =>
                  sql.includes('FROM session')
                    ? [
                        {
                          id: 'ses_valid',
                          parent_id: 'parent',
                          title: 'Valid',
                          agent: 'agent',
                          time_created: 1,
                          time_updated: 2,
                          tokens_input: 3,
                        },
                        { id: '', parent_id: 'parent', title: '' },
                      ]
                    : [
                        {
                          session_id: 'ses_valid',
                          data: JSON.stringify({ type: 'session.error', time: { end: '2026-01-01T00:00:02.000Z' } }),
                          time_created: 1,
                          time_updated: 2,
                        },
                        { session_id: '', data: '{}', time_created: 1, time_updated: 2 },
                        { session_id: 'ses_valid', data: 'bad', time_created: 1, time_updated: 2 },
                      ],
              };
            }
          },
        }) as never,
    );
    await expect(reader(databasePath, 'parent')).resolves.toMatchObject([{ id: 'ses_valid', status: 'error' }]);
    expect(close).toHaveBeenCalledOnce();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reconciles terminal recovery aliases and collapses matching work items', () => {
    const session = child('ses_real', {
      title: 'Build thing',
      status: 'done',
      source: 'session',
      endedAt: '2026-01-01T00:01:00.000Z',
    });
    const synthetic = child('tool-1', {
      title: 'Build thing (delegate)',
      source: 'tool',
      status: 'running',
      targetSessionID: 'ses_real',
    });
    const result = reconcileNormalizedChildrenState(state([session]), [synthetic], {
      terminalRecoverySessionIDs: new Set(['ses_real']),
    });
    expect(result.changed).toBe(true);
    expect(collapseSubagentWorkItems([session, synthetic])).toHaveLength(1);
    expect(isVisibleWorkItem(child('done', { status: 'done', endedAt: 'invalid' }))).toBe(false);
  });

  it('handles display time and truncation boundaries', () => {
    expect(formatRelativeRecency(undefined)).toBe('');
    expect(formatRelativeRecency('invalid')).toBe('');
    expect(formatRelativeRecency('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:00:04.000Z'))).toBe('now');
    expect(formatRelativeRecency('2026-01-01T00:00:00.000Z', Date.parse('2026-01-02T01:01:00.000Z'))).toBe('1d ago');
    expect(truncateLabel('label', 0)).toBe('');
    expect(truncateLabel('label', 1)).toBe('…');
  });
});
