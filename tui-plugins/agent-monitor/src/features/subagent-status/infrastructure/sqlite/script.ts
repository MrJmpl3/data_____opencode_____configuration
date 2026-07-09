import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SubagentChild, SubagentTokens } from '../../domain/types.ts';
import { normalizeSubagentTokens } from '../../domain/tokens.ts';
import { debugLog } from '../../shared/display.ts';
import { asString, isPlainObject as isRecord, toFiniteNumber } from '../../../../kit/coercion.ts';

export type SQLiteRecoveryRow = {
  id: string;
  parentID: string;
  title: string;
  agentName?: string;
  startedAtMs: number;
  updatedAtMs: number;
  endedAtMs: number;
  partCount: number;
  stepStartCount: number;
  status: SubagentChild['status'];
  evidence: 'explicit' | 'ambiguous' | null;
  tokens?: SubagentTokens;
};

const SQLITE_RECOVERY_TIMEOUT_MS = 2_000;

// Resolve the recovery script path next to this module. Kept as a separate `.py` file
// (not a template literal) so it gets real Python syntax highlighting, linting, and
// static analysis in the editor.
const RECOVERY_SCRIPT_PATH = fileURLToPath(new URL('./recovery.py', import.meta.url));

const runSQLiteRecoveryScript = async (databasePath: string, parentSessionID: string): Promise<string | undefined> => {
  debugLog(`[subagent-status] runSQLiteRecoveryScript called: db=${databasePath} parent=${parentSessionID}`);
  const result = spawnSync('python3', [RECOVERY_SCRIPT_PATH, databasePath, parentSessionID], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: SQLITE_RECOVERY_TIMEOUT_MS,
  });

  debugLog(
    `[subagent-status] python result: status=${result.status} stdout_len=${result.stdout?.length ?? 0} stderr=${result.stderr?.slice(0, 200) ?? ''}`,
  );
  return result.status === 0 && result.stdout.trim() ? result.stdout : undefined;
};

const normalizeSQLiteRecoveryRow = (input: unknown): SQLiteRecoveryRow | undefined => {
  if (!isRecord(input)) return undefined;

  const id = asString(input.id);
  const parentID = asString(input.parentID);
  const title = asString(input.title);
  const startedAtMs = toFiniteNumber(input.startedAtMs);
  const updatedAtMs = toFiniteNumber(input.updatedAtMs);
  if (!id || !parentID || !title || startedAtMs === undefined || updatedAtMs === undefined) {
    return undefined;
  }

  const endedAtMs = toFiniteNumber(input.endedAtMs) ?? 0;
  const rawStatus = asString(input.status);
  const status: SubagentChild['status'] =
    rawStatus === 'done' || rawStatus === 'error' || rawStatus === 'running' ? rawStatus : 'running';
  const rawEvidence = asString(input.evidence);
  const evidence: SQLiteRecoveryRow['evidence'] =
    rawEvidence === 'explicit' || rawEvidence === 'ambiguous' ? rawEvidence : null;

  return {
    id,
    parentID,
    title,
    agentName: asString(input.agentName),
    startedAtMs,
    updatedAtMs,
    endedAtMs,
    partCount: Math.max(0, Math.floor(toFiniteNumber(input.partCount) ?? 0)),
    stepStartCount: Math.max(0, Math.floor(toFiniteNumber(input.stepStartCount) ?? 0)),
    status,
    evidence,
    tokens: normalizeSubagentTokens(input.tokens),
  };
};

export const readSQLiteRecoveryRows = async (
  databasePath: string,
  parentSessionID: string,
): Promise<SQLiteRecoveryRow[]> => {
  if (!existsSync(databasePath)) return [];

  const stdout = await runSQLiteRecoveryScript(databasePath, parentSessionID);
  if (!stdout) return [];

  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed.map(normalizeSQLiteRecoveryRow).filter((row) => row !== undefined) : [];
  } catch {
    return [];
  }
};
