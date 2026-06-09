import type { ShellExecutor } from './shell.ts';

export async function commandExists(shell: ShellExecutor, command = 'rtk'): Promise<boolean> {
  try {
    await shell`which ${command}`.quiet();

    return true;
  } catch {
    return false;
  }
}

export async function rewriteCommand(shell: ShellExecutor, command: string): Promise<string | undefined> {
  try {
    const result = await shell`rtk rewrite ${command}`.quiet().nothrow();
    const rewritten = String(result.stdout).trim();

    return rewritten && rewritten !== command ? rewritten : undefined;
  } catch {
    return undefined;
  }
}
