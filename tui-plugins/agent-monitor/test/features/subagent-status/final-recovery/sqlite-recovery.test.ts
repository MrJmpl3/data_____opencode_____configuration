import { describe, expect, it } from 'vitest';

import {
  resolveRecoveredStatus,
  safeParseParts,
} from '../../../../src/features/subagent-status/infrastructure/sqlite/recovery-classifier.ts';
import { createSQLiteRecoveryRowsReader } from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';

describe('final SQLite recovery precedence', () => {
  it('uses status-only explicit evidence and latest equal-time terminal evidence', () => {
    expect(resolveRecoveredStatus([{ type: 'session.error' }])).toMatchObject({ status: 'error', endedAt: undefined });
    expect(
      resolveRecoveredStatus([
        { type: 'session.completed', time: { end: '2026-06-04T12:00:00.000Z' }, tokens: { input: 1 } },
        { type: 'session.error', time: { end: '2026-06-04T12:00:00.000Z' }, tokens: { output: 2 } },
      ]),
    ).toMatchObject({ status: 'error', tokens: { input: 1, output: 2 } });
  });

  it('treats equal-time ambiguous finishes as terminal and older finishes as running', () => {
    expect(
      resolveRecoveredStatus([{ type: 'step-finish', reason: 'stop', time: { end: '2026-06-04T12:01:00.000Z' } }]),
    ).toMatchObject({ status: 'done', evidence: 'ambiguous' });
    expect(
      resolveRecoveredStatus([
        { type: 'step-finish', reason: 'error', time: { end: '2026-06-04T12:01:00.000Z' } },
        { type: 'step-start', time: { start: '2026-06-04T12:01:00.000Z' } },
      ]).status,
    ).toBe('error');
    expect(safeParseParts(['', 'false', '[]'])).toEqual([undefined, false, []]);
  });

  it('skips absent databases and malformed SQLite payloads while closing the database', async () => {
    const close = () => {
      throw new Error('close failure');
    };
    const all = (sql: string) =>
      sql.includes('FROM session')
        ? [{ id: 'ses_child', parent_id: 'ses_parent', title: 'Child', time_created: 'bad', time_updated: 2 }]
        : [{ session_id: 'ses_child', data: '{bad', time_created: 1, time_updated: 2 }];
    const reader = createSQLiteRecoveryRowsReader(() => ({
      DatabaseSync: class {
        prepare(sql: string) {
          return { all: () => all(sql) };
        }
        close = close;
      } as never,
    }));
    await expect(reader('/etc/hosts', 'ses_parent')).resolves.toMatchObject([
      { id: 'ses_child', status: 'running', partCount: 1 },
    ]);
    await expect(reader('/path/that/is/not/a/database', 'ses_parent')).resolves.toEqual([]);
  });
});
