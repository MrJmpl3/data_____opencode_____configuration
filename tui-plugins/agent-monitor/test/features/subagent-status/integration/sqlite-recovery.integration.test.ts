import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const hasPython = ((): boolean => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
})();

const itOrSkip = hasPython ? it : it.skip;
const describeOrSkip = hasPython ? describe : describe.skip;

import {
  readSQLiteRecoveryRows,
  type SQLiteRecoveryRow,
} from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';

const SEED_DB_SCRIPT = `
import sqlite3, sys, json

path = sys.argv[1]
parent_id = sys.argv[2]

conn = sqlite3.connect(path)
cur = conn.cursor()

cur.execute("""
    CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        title TEXT,
        agent TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        tokens_input INTEGER,
        tokens_output INTEGER,
        tokens_reasoning INTEGER,
        tokens_cache_read INTEGER,
        tokens_cache_write INTEGER
    )
""")

cur.execute("""
    CREATE TABLE part (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT REFERENCES session(id),
        data TEXT,
        time_created INTEGER,
        time_updated INTEGER
    )
""")

# Session 1: completed session with explicit "done" status.
cur.execute(
    "INSERT INTO session (id, parent_id, title, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
    ("ses_done", parent_id, "Completed Analysis", "agent-alpha", 1_700_000_000_000, 1_700_000_100_000),
)

cur.execute(
    "INSERT INTO part (session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?)",
    ("ses_done", json.dumps({"type": "session.completed", "status": "done"}), 1_700_000_100_000, 1_700_000_100_000),
)

# Session 2: running session (no terminal part).
cur.execute(
    "INSERT INTO session (id, parent_id, title, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
    ("ses_running", parent_id, "In Progress Task", "agent-beta", 1_700_000_200_000, 1_700_000_250_000),
)

cur.execute(
    "INSERT INTO part (session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?)",
    ("ses_running", json.dumps({"type": "step-start"}), 1_700_000_250_000, 1_700_000_250_000),
)

# Session 3: error session via explicit session.error type.
cur.execute(
    "INSERT INTO session (id, parent_id, title, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
    ("ses_error", parent_id, "Failed Operation", "agent-gamma", 1_700_000_300_000, 1_700_000_350_000),
)

cur.execute(
    "INSERT INTO part (session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?)",
    ("ses_error", json.dumps({"type": "session.error"}), 1_700_000_350_000, 1_700_000_350_000),
)

# Session 4: completed via ambiguous step-finish with reason "stop".
cur.execute(
    "INSERT INTO session (id, parent_id, title, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
    ("ses_ambiguous_done", parent_id, "Ambiguous Done", "agent-delta", 1_700_000_400_000, 1_700_000_450_000),
)

cur.execute(
    "INSERT INTO part (session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?)",
    ("ses_ambiguous_done", json.dumps({"type": "step-start"}), 1_700_000_400_000, 1_700_000_400_000),
)

cur.execute(
    "INSERT INTO part (session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?)",
    ("ses_ambiguous_done", json.dumps({"type": "step-finish", "reason": "stop"}), 1_700_000_450_000, 1_700_000_450_000),
)

conn.commit()
conn.close()

print("seeded")
`;

describeOrSkip('SQLite recovery integration', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const file of tempFiles) {
      rmSync(file, { recursive: true, force: true });
    }
  });

  it('reads and classifies seeded SQLite recovery rows correctly', async () => {
    // Create temp database.
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-'));
    const dbPath = join(tempDir, 'test.db');
    const parentSessionID = 'ses_parent_test';
    tempFiles.push(tempDir);

    // Seed the database.
    writeFileSync(join(tempDir, 'seed.py'), SEED_DB_SCRIPT);
    execFileSync('python3', [join(tempDir, 'seed.py'), dbPath, parentSessionID], {
      encoding: 'utf8',
      timeout: 5_000,
    });

    // Read back via the recovery function.
    const rows = await readSQLiteRecoveryRows(dbPath, parentSessionID);

    // We should get 4 rows.
    expect(rows).toHaveLength(4);

    // Check the "done" session.
    const doneRow = rows.find((r) => r.id === 'ses_done');
    expect(doneRow).toBeDefined();
    expect(doneRow!.parentID).toBe(parentSessionID);
    expect(doneRow!.title).toBe('Completed Analysis');
    expect(doneRow!.status).toBe('done');
    expect(doneRow!.evidence).toBe('explicit');

    // Check the "running" session.
    const runningRow = rows.find((r) => r.id === 'ses_running');
    expect(runningRow).toBeDefined();
    expect(runningRow!.parentID).toBe(parentSessionID);
    expect(runningRow!.title).toBe('In Progress Task');
    expect(runningRow!.status).toBe('running');

    // Check the "error" session.
    const errorRow = rows.find((r) => r.id === 'ses_error');
    expect(errorRow).toBeDefined();
    expect(errorRow!.parentID).toBe(parentSessionID);
    expect(errorRow!.title).toBe('Failed Operation');
    expect(errorRow!.status).toBe('error');
    expect(errorRow!.evidence).toBe('explicit');

    // Check the ambiguous "done" session (step-finish stop).
    const ambiguousDoneRow = rows.find((r) => r.id === 'ses_ambiguous_done');
    expect(ambiguousDoneRow).toBeDefined();
    expect(ambiguousDoneRow!.parentID).toBe(parentSessionID);
    expect(ambiguousDoneRow!.title).toBe('Ambiguous Done');
    expect(ambiguousDoneRow!.status).toBe('done');
    expect(ambiguousDoneRow!.evidence).toBe('ambiguous');

    // Verify all rows have id, parentID, title, status values.
    for (const row of rows) {
      expect(typeof row.id).toBe('string');
      expect(row.id.length).toBeGreaterThan(0);
      expect(typeof row.parentID).toBe('string');
      expect(row.parentID.length).toBeGreaterThan(0);
      expect(typeof row.title).toBe('string');
      expect(row.title.length).toBeGreaterThan(0);
      expect(['done', 'running', 'error'].includes(row.status)).toBe(true);
      expect(typeof row.startedAtMs).toBe('number');
      expect(typeof row.updatedAtMs).toBe('number');
    }
  });

  it('returns an empty array for a non-existent parent session ID', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'agent-monitor-sqlite-'));
    const dbPath = join(tempDir, 'test.db');
    tempFiles.push(tempDir);

    // Seed with one session.
    writeFileSync(join(tempDir, 'seed.py'), SEED_DB_SCRIPT);
    execFileSync('python3', [join(tempDir, 'seed.py'), dbPath, 'ses_real_parent'], {
      encoding: 'utf8',
      timeout: 5_000,
    });

    // Query with a different parent — should return empty.
    const rows = await readSQLiteRecoveryRows(dbPath, 'ses_nonexistent_parent');
    expect(rows).toHaveLength(0);
  });

  it('returns an empty array when the database does not exist', async () => {
    const rows = await readSQLiteRecoveryRows('/tmp/nonexistent-db-12345.db', 'ses_parent');
    expect(rows).toHaveLength(0);
  });
});
