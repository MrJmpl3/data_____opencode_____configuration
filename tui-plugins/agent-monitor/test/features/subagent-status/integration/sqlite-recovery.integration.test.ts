import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSQLiteRecoveryRowsReader,
  readSQLiteRecoveryRows,
} from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';

type Database = { close(): void; exec(sql: string): void };
type SQLiteTestModule = { DatabaseSync: new (path: string) => Database };
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as SQLiteTestModule;

const seedDatabase = (path: string, parentID: string): void => {
  const database = new DatabaseSync(path);
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  database.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, agent TEXT, time_created INTEGER,
      time_updated INTEGER, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
      tokens_cache_read INTEGER, tokens_cache_write INTEGER);
    CREATE TABLE part (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, data TEXT,
      time_created INTEGER, time_updated INTEGER);
    INSERT INTO session VALUES ('ses_done', ${quote(parentID)}, 'Completed Analysis', 'agent-alpha', 1700000000000, 1700000100000, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO part (session_id, data, time_created, time_updated) VALUES ('ses_done', '{"type":"session.completed","status":"done"}', 1700000100000, 1700000100000);
    INSERT INTO session VALUES ('ses_running', ${quote(parentID)}, 'In Progress Task', 'agent-beta', 1700000200000, 1700000250000, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO part (session_id, data, time_created, time_updated) VALUES ('ses_running', '{"type":"step-start"}', 1700000250000, 1700000250000);
    INSERT INTO session VALUES ('ses_error', ${quote(parentID)}, 'Failed Operation', 'agent-gamma', 1700000300000, 1700000350000, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO part (session_id, data, time_created, time_updated) VALUES ('ses_error', '{"type":"session.error"}', 1700000350000, 1700000350000);
    INSERT INTO session VALUES ('ses_ambiguous_done', ${quote(parentID)}, 'Ambiguous Done', 'agent-delta', 1700000400000, 1700000450000, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO part (session_id, data, time_created, time_updated) VALUES ('ses_ambiguous_done', '{"type":"step-start"}', 1700000400000, 1700000400000);
    INSERT INTO part (session_id, data, time_created, time_updated) VALUES ('ses_ambiguous_done', '{"type":"step-finish","reason":"stop"}', 1700000450000, 1700000450000);
  `);
  database.close();
};

describe('SQLite recovery integration', () => {
  const tempDirectories: string[] = [];
  afterEach(() => tempDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

  it('reads and classifies rows without an external interpreter', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-'));
    const path = join(directory, 'test.db');
    tempDirectories.push(directory);
    seedDatabase(path, 'ses_parent_test');

    const rows = await readSQLiteRecoveryRows(path, 'ses_parent_test');
    expect(rows.map(({ id, status, evidence }) => ({ id, status, evidence }))).toEqual([
      { id: 'ses_ambiguous_done', status: 'done', evidence: 'ambiguous' },
      { id: 'ses_error', status: 'error', evidence: 'explicit' },
      { id: 'ses_running', status: 'running', evidence: null },
      { id: 'ses_done', status: 'done', evidence: 'explicit' },
    ]);
  });

  it('returns an empty array for missing databases and parents', async () => {
    expect(await readSQLiteRecoveryRows('/tmp/nonexistent-db-12345.db', 'ses_parent')).toEqual([]);
    const directory = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-'));
    const path = join(directory, 'test.db');
    tempDirectories.push(directory);
    seedDatabase(path, 'ses_real_parent');
    expect(await readSQLiteRecoveryRows(path, 'ses_other_parent')).toEqual([]);
  });

  it('degrades SQLite recovery when SQLite is unavailable without affecting plugin module loading', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-'));
    const path = join(directory, 'test.db');
    tempDirectories.push(directory);
    writeFileSync(path, 'placeholder');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = createSQLiteRecoveryRowsReader(() => {
      throw new Error('node:sqlite unavailable');
    });

    await expect(reader(path, 'ses_parent')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith('[agent-monitor] SQLite recovery failed:', expect.any(Error));
  });

  it('returns recovered rows when closing the database fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-'));
    const path = join(directory, 'test.db');
    tempDirectories.push(directory);
    writeFileSync(path, 'placeholder');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = createSQLiteRecoveryRowsReader(() => ({
      DatabaseSync: class {
        prepare(sql: string) {
          return {
            all: () =>
              sql.includes('FROM session')
                ? [
                    {
                      id: 'ses_child',
                      parent_id: 'ses_parent',
                      title: 'Recovered child',
                      time_created: 1700000000000,
                      time_updated: 1700000100000,
                    },
                  ]
                : [],
          };
        }

        close() {
          throw new Error('close failed');
        }
      },
    }));

    await expect(reader(path, 'ses_parent')).resolves.toMatchObject([{ id: 'ses_child', status: 'running' }]);
    expect(warn).toHaveBeenCalledWith('[agent-monitor] Failed to close SQLite recovery database:', expect.any(Error));
  });
});
