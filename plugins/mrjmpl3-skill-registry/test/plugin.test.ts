import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

describe('mrjmpl3-skill-registry plugin', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    consoleErrorSpy.mockClear();
  });

  it('refreshes the skill registry once from the system transform hook', async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: { timeout: number }, callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const { SkillRegistryPlugin } = await import('../index.ts');
    const plugin = await SkillRegistryPlugin({ directory: '/tmp/project' } as never);

    await plugin['experimental.chat.system.transform']?.({} as never, { system: [] } as never);
    await plugin['experimental.chat.system.transform']?.({} as never, { system: [] } as never);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      'gentle-ai',
      ['skill-registry', 'refresh', '--quiet', '--no-gitignore', '--cwd', '/tmp/project'],
      { timeout: 10_000 },
      expect.any(Function),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('logs refresh command failures without throwing', async () => {
    const refreshError = new Error('spawn gentle-ai ENOENT');

    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: { timeout: number }, callback: (error: Error | null) => void) => {
        callback(refreshError);
      },
    );

    const { refreshSkillRegistry } = await import('../index.ts');

    await expect(refreshSkillRegistry('/tmp/project')).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'mrjmpl3-skill-registry: failed to refresh skill registry',
      refreshError,
    );
  });
});
