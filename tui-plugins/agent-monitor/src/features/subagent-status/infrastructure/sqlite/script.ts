import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

import type { SubagentChild, SubagentTokens } from '../../domain/types.ts';
import { mergeSubagentTokens, normalizeSubagentTokens } from '../../domain/tokens.ts';
import { asString, isRecord, toFiniteNumber } from '../../../../kit/coercion.ts';
import { resolveRecoveredStatus } from './recovery-classifier.ts';

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

type SQLiteValue = string | number | bigint | Uint8Array | null;
type SQLiteRow = Record<string, SQLiteValue>;
type SQLiteDatabase = {
  close(): void;
  prepare(sql: string): { all(...parameters: SQLiteValue[]): SQLiteRow[] };
};
type SQLiteModule = { DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SQLiteDatabase };

type LoadSQLiteModule = () => SQLiteModule;

const loadSQLiteModule: LoadSQLiteModule = () => createRequire(import.meta.url)('node:sqlite') as SQLiteModule;

const numericValue = (value: SQLiteValue | undefined): number => toFiniteNumber(value) ?? 0;

const parsePart = (row: SQLiteRow): unknown => {
  if (typeof row.data !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (!isRecord(parsed)) return parsed;
    const time = isRecord(parsed.time) ? parsed.time : {};
    return {
      ...parsed,
      time: { updated: numericValue(row.time_updated), created: numericValue(row.time_created), ...time },
    };
  } catch (error) {
    console.warn(
      '[agent-monitor] Failed to parse SQLite recovery part:',
      error instanceof Error ? error : String(error),
    );
    return undefined;
  }
};

const rowTokens = (row: SQLiteRow): SubagentTokens | undefined =>
  normalizeSubagentTokens({
    input: row.tokens_input,
    output: row.tokens_output,
    reasoning: row.tokens_reasoning,
    cache_read: row.tokens_cache_read,
    cache_write: row.tokens_cache_write,
  });

export const createSQLiteRecoveryRowsReader =
  (loadSQLite: LoadSQLiteModule = loadSQLiteModule) =>
  async (databasePath: string, parentSessionID: string): Promise<SQLiteRecoveryRow[]> => {
    if (!existsSync(databasePath)) return [];

    let database: SQLiteDatabase | undefined;
    try {
      const { DatabaseSync } = loadSQLite();
      database = new DatabaseSync(databasePath, { readOnly: true });
      const sessions = database
        .prepare(
          `SELECT id, parent_id, title, agent, time_created, time_updated,
                tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write
           FROM session WHERE parent_id = ? ORDER BY time_updated DESC, id DESC`,
        )
        .all(parentSessionID);
      const partRows = database
        .prepare(
          `SELECT p.session_id, p.data, p.time_created, p.time_updated
           FROM part p INNER JOIN session s ON s.id = p.session_id
          WHERE s.parent_id = ?
          ORDER BY p.session_id ASC, p.time_updated ASC, p.time_created ASC, p.id ASC`,
        )
        .all(parentSessionID);
      const partsBySession = new Map<string, SQLiteRow[]>();
      for (const partRow of partRows) {
        const sessionID = asString(partRow.session_id);
        if (!sessionID) continue;
        const parts = partsBySession.get(sessionID);
        if (parts) parts.push(partRow);
        else partsBySession.set(sessionID, [partRow]);
      }

      return sessions.flatMap((session): SQLiteRecoveryRow[] => {
        const id = asString(session.id);
        const parentID = asString(session.parent_id);
        const title = asString(session.title);
        if (!id || !parentID || !title) return [];
        const partRowsForSession = partsBySession.get(id) ?? [];
        const parts = partRowsForSession.map(parsePart);
        const recovered = resolveRecoveredStatus(parts);
        return [
          {
            id,
            parentID,
            title,
            agentName: asString(session.agent),
            startedAtMs: numericValue(session.time_created),
            updatedAtMs: numericValue(session.time_updated),
            endedAtMs: recovered.endedAt ? Date.parse(recovered.endedAt) : 0,
            partCount: partRowsForSession.length,
            stepStartCount: parts.filter((part) => isRecord(part) && part.type === 'step-start').length,
            status: recovered.status,
            evidence: recovered.evidence ?? null,
            tokens: mergeSubagentTokens(rowTokens(session), recovered.tokens),
          },
        ];
      });
    } catch (error) {
      console.warn('[agent-monitor] SQLite recovery failed:', error instanceof Error ? error : String(error));
      return [];
    } finally {
      try {
        database?.close();
      } catch (error) {
        console.warn(
          '[agent-monitor] Failed to close SQLite recovery database:',
          error instanceof Error ? error : String(error),
        );
      }
    }
  };

export const readSQLiteRecoveryRows = createSQLiteRecoveryRowsReader();
