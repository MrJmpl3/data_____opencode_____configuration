import type { SubagentState } from '../../domain/types.ts';
import { debugLog } from '../../shared/display.ts';
import { DEFAULT_STALE_RUNNING_PROBE_POLICY } from '../../runtime/options.ts';

import { applyRecoveredChildren } from '../recovery.ts';
import type { RecoveryContext, RecoveryResult, RecoverySource } from '../recovery.ts';
import { readSQLiteRecoveryRows } from './script.ts';
import type { SQLiteRecoveryRow } from './script.ts';
import { mapRecoveredChild } from './map-recovered-child.ts';

// Re-export the public recovery helpers from the classifier module so
// existing imports of `resolveRecoveredStatus` / `safeParseParts` from this
// file keep working without churn.
export { resolveRecoveredStatus, safeParseParts } from './recovery-classifier.ts';
export type { RecoveredStatus } from './recovery-classifier.ts';

// `readRows` is an optional seam so unit tests can inject a fake
// row provider. Production callers rely on the default which spawns the
// Python recovery script. The default value is computed lazily so tests that
// pass a stub never touch `node:fs` or the `python3` binary.
export type ReadSQLiteRecoveryRows = (databasePath: string, parentSessionID: string) => Promise<SQLiteRecoveryRow[]>;

export const createSQLiteRecoverySource = (input: {
  databasePath: string;
  hardStaleAfterMs?: number;
  readRows?: ReadSQLiteRecoveryRows;
}): RecoverySource => {
  const databasePath = input.databasePath;
  const hardStaleAfterMs = Math.max(
    0,
    Math.floor(input.hardStaleAfterMs ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.hardStaleAfterMs),
  );
  const readRows = input.readRows ?? readSQLiteRecoveryRows;

  return {
    hydrateState: async (state: SubagentState, context: RecoveryContext): Promise<RecoveryResult | undefined> => {
      const parentSessionID = context.parentSessionID;
      if (!parentSessionID) {
        debugLog('[subagent-status] hydrateState: no parentSessionID, skipping');
        return undefined;
      }

      debugLog(`[subagent-status] hydrateState: parent=${parentSessionID} db=${databasePath}`);
      const rows = await readRows(databasePath, parentSessionID);
      debugLog(`[subagent-status] hydrateState: rows=${rows.length}`);
      if (rows.length === 0) return undefined;

      const mappedChildren = rows.map((row) => mapRecoveredChild(row, hardStaleAfterMs));
      const statuses = mappedChildren.map(({ child }) => child.status);
      debugLog(`[subagent-status] hydrateState: statuses=${JSON.stringify(statuses)}`);

      return applyRecoveredChildren(
        state,
        mappedChildren.map(({ child }) => child),
        rows.map((row) => row.id),
        parentSessionID,
        {
          protectedTerminalSessionIDs: mappedChildren
            .map(({ protectedTerminalSessionID }) => protectedTerminalSessionID)
            .filter((sessionId): sessionId is string => Boolean(sessionId)),
        },
      );
    },
  };
};
