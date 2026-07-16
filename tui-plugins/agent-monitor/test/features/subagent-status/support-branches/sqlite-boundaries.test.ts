import { describe, expect, it, vi } from 'vitest';

import {
  createSQLiteRecoveryRowsReader,
  type SQLiteRecoveryRow,
} from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';
import { createSQLiteRecoverySource } from '../../../../src/features/subagent-status/infrastructure/sqlite/hydrate.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';

const state = (): SubagentState => ({
  children: {},
  countedChildIDs: {},
  purgedSessionIDs: {},
  totalExecuted: 0,
  updatedAt: new Date().toISOString(),
});

describe('sqlite recovery boundary branches', () => {
  it('returns no rows for a missing database and closes a readable database', async () => {
    const reader = createSQLiteRecoveryRowsReader(() => {
      throw new Error('module should not load');
    });
    await expect(reader('/missing/database.sqlite', 'ses_parent')).resolves.toEqual([]);

    const close = vi.fn();
    let query = 0;
    const all = vi.fn(() =>
      query++ === 0
        ? [
            {
              id: 'ses_child',
              parent_id: 'ses_parent',
              title: 'Child',
              agent: null,
              time_created: 10,
              time_updated: 20,
              tokens_input: 2,
              tokens_output: 3,
            },
          ]
        : [],
    );
    const prepare = vi.fn(() => ({ all }));
    class FakeDatabase {
      close = close;
      prepare = prepare;
    }
    const loaded = createSQLiteRecoveryRowsReader(() => ({ DatabaseSync: FakeDatabase as never }));
    const result = await loaded('/etc/hosts', 'ses_parent');
    expect(result[0]).toMatchObject({
      id: 'ses_child',
      parentID: 'ses_parent',
      title: 'Child',
      tokens: { input: 2, output: 3 },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns empty rows and logs when the sqlite module or query fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = createSQLiteRecoveryRowsReader(() => {
      throw new Error('unavailable');
    });
    await expect(reader('/etc/hosts', 'ses_parent')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('skips hydration without a parent or rows and maps recovered rows', async () => {
    const readRows = vi.fn<() => Promise<SQLiteRecoveryRow[]>>(async () => []);
    const source = createSQLiteRecoverySource({ databasePath: 'db', readRows });
    await expect(source.hydrateState(state(), { directory: '/tmp' })).resolves.toBeUndefined();
    await expect(
      source.hydrateState(state(), { directory: '/tmp', parentSessionID: 'ses_parent' }),
    ).resolves.toBeUndefined();
    readRows.mockResolvedValue([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered',
        startedAtMs: 1,
        updatedAtMs: 2,
        endedAtMs: 3,
        partCount: 1,
        stepStartCount: 1,
        status: 'done' as const,
        evidence: 'explicit' as const,
      },
    ]);
    const recovered = await source.hydrateState(state(), { directory: '/tmp', parentSessionID: 'ses_parent' });
    expect(recovered?.changed).toBe(true);
    expect(readRows).toHaveBeenCalledWith('db', 'ses_parent');
  });
});
