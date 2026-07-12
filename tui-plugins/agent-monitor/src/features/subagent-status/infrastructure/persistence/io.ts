import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import os from 'node:os';

import type { SubagentState } from '../../domain/types.ts';

const STATUS_DIRNAME = 'agent-monitor';
const STATUS_FILENAME = 'state.json';
const STATUS_DIR_MODE = 0o700;
const STATUS_FILE_MODE = 0o600;

export const resolveStatePath = (
  input: string | { workspaceDirectory?: string; statePath?: string } = process.cwd(),
): string => {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof input.statePath === 'string' &&
    input.statePath.trim().length > 0
  ) {
    return input.statePath;
  }

  const workspaceDirectory = typeof input === 'string' ? input : (input.workspaceDirectory ?? process.cwd());
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  const resolvedWorkspaceDirectory = resolve(workspaceDirectory);
  const workspaceHash = createHash('sha256').update(resolvedWorkspaceDirectory).digest('hex').slice(0, 16);

  return join(runtimeDir, STATUS_DIRNAME, `workspace-${workspaceHash}`, STATUS_FILENAME);
};

export const resolveTextPath = (statePath: string): string => {
  return join(dirname(statePath), 'status.txt');
};

export const resolveDebugPath = (statePath: string): string => {
  return join(dirname(statePath), 'debug.json');
};

export const shouldPreserveStateOnStartup = (input?: { preserveStateOnStartup?: boolean }): boolean => {
  return input?.preserveStateOnStartup === true;
};

export const writeLocalFile = async (path: string, contents: string): Promise<void> => {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: STATUS_DIR_MODE });

  const tempPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', mode: STATUS_FILE_MODE });
    await rename(tempPath, path);
  } catch (error) {
    // Temp file cleanup is best-effort — if it fails the original
    // error (the write/rename failure) is what matters to the caller.
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const saveState = async (statePath: string, state: SubagentState): Promise<void> => {
  const { recovering, ...persistable } = state;
  await writeLocalFile(statePath, JSON.stringify(persistable, null, 2));
};
