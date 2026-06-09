import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';

import type { OpencodeClient } from './types.ts';

export async function refreshSkillRegistry(
  directory: string,
  log: (level: 'info' | 'warn' | 'error', message: string) => void,
): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile(
      'gentle-ai',
      ['skill-registry', 'refresh', '--quiet', '--no-gitignore', '--cwd', directory],
      { timeout: 10_000 },
      (error) => {
        if (error) {
          log('warn', `skill-registry refresh skipped: ${error.message}`);
        } else {
          log('info', 'skill-registry refresh completed');
        }
        resolve();
      },
    );
  });
}

export class TimeoutError extends Error {
  readonly name = 'TimeoutError' as const;
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.timeoutMs = timeoutMs;
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> {
  if (typeof ms !== 'number' || ms < 0) {
    throw new Error(`withTimeout: timeout must be a non-negative number, got ${ms}`);
  }
  if (ms === 0) {
    throw new TimeoutError(message, ms);
  }

  let timeoutId: ReturnType<typeof setTimeout>;

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new TimeoutError(message, ms));
      }, ms);
    }),
  ]);
}

export function logWarn(client: OpencodeClient | undefined, service: string, message: string): void {
  if (!client) {
    console.warn(`[${service}] ${message}`);

    return;
  }

  client.app.log({ body: { service, level: 'warn', message } }).catch(() => {});
}

function hashPath(projectRoot: string): string {
  const hash = crypto.createHash('sha256').update(projectRoot).digest('hex');

  return hash.slice(0, 16);
}

export async function getProjectId(projectRoot: string): Promise<string> {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('getProjectId: projectRoot is required and must be a string');
  }

  const gitPath = path.join(projectRoot, '.git');
  const gitStat = await stat(gitPath).catch(() => null);
  if (!gitStat) {
    return hashPath(projectRoot);
  }

  let gitDir = gitPath;
  if (gitStat.isFile()) {
    const content = await Bun.file(gitPath).text();
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) {
      throw new Error(`getProjectId: .git file exists but has invalid format at ${gitPath}`);
    }

    const gitdirPath = match[1].trim();
    const resolvedGitdir = path.resolve(projectRoot, gitdirPath);
    const commondirPath = path.join(resolvedGitdir, 'commondir');
    const commondirFile = Bun.file(commondirPath);

    if (await commondirFile.exists()) {
      const commondirContent = (await commondirFile.text()).trim();
      gitDir = path.resolve(resolvedGitdir, commondirContent);
    } else {
      gitDir = path.resolve(resolvedGitdir, '../..');
    }

    const gitDirStat = await stat(gitDir).catch(() => null);
    if (!gitDirStat?.isDirectory()) {
      throw new Error(`getProjectId: Resolved gitdir ${gitDir} is not a directory`);
    }
  }

  const cacheFile = path.join(gitDir, 'opencode');
  const cache = Bun.file(cacheFile);
  if (await cache.exists()) {
    const cached = (await cache.text()).trim();
    if (/^[a-f0-9]{40}$/i.test(cached) || /^[a-f0-9]{16}$/i.test(cached)) {
      return cached;
    }
  }

  try {
    const proc = Bun.spawn(['git', 'rev-list', '--max-parents=0', '--all'], {
      cwd: projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
    });
    const exitCode = await withTimeout(proc.exited, 5000, 'git rev-list timed out').catch((error) => {
      if (error instanceof TimeoutError) {
        proc.kill();
      }

      return 1;
    });

    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      const roots = output
        .split('\n')
        .filter(Boolean)
        .map((root) => root.trim())
        .sort();

      if (roots.length > 0 && /^[a-f0-9]{40}$/i.test(roots[0])) {
        const projectId = roots[0];
        try {
          await Bun.write(cacheFile, projectId);
        } catch {}

        return projectId;
      }
    }
  } catch {}

  return hashPath(projectRoot);
}
