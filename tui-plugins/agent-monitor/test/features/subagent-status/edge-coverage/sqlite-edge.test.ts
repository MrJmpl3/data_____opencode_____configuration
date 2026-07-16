import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveRecoveredStatus,
  safeParseParts,
} from '../../../../src/features/subagent-status/infrastructure/sqlite/recovery-classifier.ts';
import { createSQLiteRecoveryRowsReader } from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';

describe('SQLite recovery classification boundaries', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it.each([
    [[], 'running'],
    [[{ type: 'session.updated', status: 'completed' }], 'done'],
    [[{ type: 'session.updated', error: 'failed' }], 'error'],
    [[{ type: 'session.updated' }], 'running'],
    [[{ type: 'step-finish', reason: 'error', time: { end: '2026-06-05T10:00:00.000Z' } }], 'error'],
    [[{ type: 'step-finish', reason: 'stop', time: { end: 'not-a-date' } }], 'running'],
  ])('classifies terminal evidence %j', (parts, status) => {
    expect(resolveRecoveredStatus(parts).status).toBe(status);
  });

  it('uses latest terminal timestamps and preserves fallback tokens', () => {
    const result = resolveRecoveredStatus([
      { type: 'session.completed', time: { end: '2026-06-05T10:00:00.000Z' }, tokens: { input: 1 } },
      { type: 'session.error', time: { end: '2026-06-05T10:01:00.000Z' }, tokens: { output: 2 } },
    ]);
    expect(result).toMatchObject({ status: 'error', tokens: { input: 1, output: 2 } });
  });

  it('converts malformed JSON values to undefined', () => {
    expect(safeParseParts(['null', '{bad', '42'])).toEqual([null, undefined, 42]);
  });

  it('reads valid rows, skips malformed sessions, and closes after a query failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-sqlite-'));
    directories.push(directory);
    const databasePath = join(directory, 'db');
    await writeFile(databasePath, 'placeholder');
    const close = vi.fn();
    const all = vi
      .fn()
      .mockReturnValueOnce([
        {
          id: 'ses_good',
          parent_id: 'ses_parent',
          title: 'Good',
          agent: 'worker',
          time_created: 10,
          time_updated: 20,
          tokens_input: 3,
        },
        { id: null, parent_id: 'ses_parent', title: 'Skipped' },
      ])
      .mockReturnValueOnce([
        {
          session_id: 'ses_good',
          data: JSON.stringify({
            type: 'session.completed',
            status: 'done',
            time: { end: '2026-06-05T10:00:00.000Z' },
          }),
          time_created: 1,
          time_updated: 2,
        },
        { session_id: null, data: '{}', time_created: 1, time_updated: 2 },
      ]);
    const reader = createSQLiteRecoveryRowsReader(() => ({
      DatabaseSync: class {
        prepare() {
          return { all };
        }
        close = close;
      } as never,
    }));

    const result = await reader(databasePath, 'ses_parent');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'ses_good',
      status: 'done',
      partCount: 1,
      stepStartCount: 0,
      tokens: { input: 3 },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns an empty result and still attempts close when SQLite setup fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-sqlite-fail-'));
    directories.push(directory);
    const path = join(directory, 'db');
    await writeFile(path, 'placeholder');
    const close = vi.fn(() => {
      throw new Error('close failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = createSQLiteRecoveryRowsReader(() => {
      throw new Error('open failed');
    });

    await expect(reader(path, 'ses_parent')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
