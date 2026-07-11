import type { SubagentState } from '../../domain/types.ts';
import type { PersistedSnapshotArtifacts } from '../../shared/display.ts';

import { createSerializedTaskQueue } from '../../runtime/queue.ts';

import { resolveDebugPath, saveState, writeLocalFile } from './io.ts';

const saveStatusText = async (textPath: string, contents: string): Promise<void> => {
  await writeLocalFile(textPath, contents);
};

const saveDebugSnapshot = async (debugPath: string, contents: string): Promise<void> => {
  await writeLocalFile(debugPath, contents);
};

export const persistSnapshot = async (
  statePath: string,
  textPath: string,
  state: SubagentState,
  artifacts: PersistedSnapshotArtifacts,
): Promise<void> => {
  try {
    await saveState(statePath, state);
    await saveStatusText(textPath, artifacts.statusText);
    await saveDebugSnapshot(resolveDebugPath(statePath), artifacts.debugSnapshot);
  } catch (e) {
    // No sessionId here: persistSnapshot is invoked through a queue that
    // loses the per-call context. The format is preserved so the same
    // grep pattern (`[agent-monitor] ... :`) still surfaces the failure.
    console.warn('[agent-monitor] Failed to persist snapshot:', e instanceof Error ? e.message : String(e));
  }
};

export const createPersistQueue = <TMeta>(
  statePath: string,
  textPath: string,
  formatArtifacts: (state: SubagentState, meta: TMeta) => PersistedSnapshotArtifacts,
) => {
  const enqueue = createSerializedTaskQueue(async (payload: { state: SubagentState; meta: TMeta }) => {
    await persistSnapshot(statePath, textPath, payload.state, formatArtifacts(payload.state, payload.meta));
  });

  return (state: SubagentState, meta: TMeta): Promise<void> => enqueue({ state: structuredClone(state), meta });
};
