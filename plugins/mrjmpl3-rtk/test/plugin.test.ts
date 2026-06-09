import { describe, expect, it, vi } from 'vitest';

import { RtkOpenCodePlugin } from '../index.ts';
import type { ShellCommand, ShellExecutor, ShellResult } from '../src/runtime/shell.ts';

interface ShellMockOptions {
  available?: boolean;
  rewrites?: Record<string, string>;
  throwOnRewrite?: boolean;
}

function renderCommand(strings: TemplateStringsArray, values: string[]): string {
  return strings.reduce(
    (command, part, index) => `${command}${part}${index < values.length ? String(values[index]) : ''}`,
    '',
  );
}

function createShellMock({ available = true, rewrites = {}, throwOnRewrite = false }: ShellMockOptions = {}) {
  const calls: string[] = [];

  const shell: ShellExecutor = (strings, ...values): ShellCommand => {
    const command = renderCommand(strings, values);
    calls.push(command);

    const commandResult: ShellCommand = {
      quiet() {
        return commandResult;
      },
      async nothrow(): Promise<ShellResult> {
        if (throwOnRewrite && command.startsWith('rtk rewrite ')) {
          throw new Error('rewrite failed');
        }

        const original = command.replace(/^rtk rewrite /, '');

        return { stdout: rewrites[original] ?? original };
      },
      then(resolve, reject) {
        const promise = available ? Promise.resolve(undefined) : Promise.reject(new Error('not found'));

        return promise.then(resolve, reject);
      },
    };

    return commandResult;
  };

  return { calls, shell };
}

describe('mrjmpl3-rtk plugin', () => {
  it('disables itself when rtk is not available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { shell } = createShellMock({ available: false });

    const plugin = await RtkOpenCodePlugin({ $: shell } as never);

    expect(plugin).toEqual({});
    expect(warn).toHaveBeenCalledWith('[mrjmpl3-rtk] rtk binary not found in PATH — plugin disabled');

    warn.mockRestore();
  });

  it('rewrites bash and shell commands with rtk rewrite', async () => {
    const { shell } = createShellMock({
      rewrites: {
        'grep -R TODO .': 'rg TODO .',
        'find . -name package.json': 'fd package.json .',
      },
    });
    const plugin = await RtkOpenCodePlugin({ $: shell } as never);

    const bashOutput = { args: { command: 'grep -R TODO .' } };
    const shellOutput = { args: { command: 'find . -name package.json' } };

    await plugin['tool.execute.before']?.({ tool: 'bash', sessionID: 'session', callID: 'call-1' }, bashOutput);
    await plugin['tool.execute.before']?.({ tool: 'shell', sessionID: 'session', callID: 'call-2' }, shellOutput);

    expect(bashOutput.args.command).toBe('rg TODO .');
    expect(shellOutput.args.command).toBe('fd package.json .');
  });

  it('leaves unsupported tools and non-string commands unchanged', async () => {
    const { shell } = createShellMock({ rewrites: { 'grep -R TODO .': 'rg TODO .' } });
    const plugin = await RtkOpenCodePlugin({ $: shell } as never);
    const unsupportedOutput = { args: { command: 'grep -R TODO .' } };
    const invalidOutput = { args: { command: 123 } };

    await plugin['tool.execute.before']?.({ tool: 'read', sessionID: 'session', callID: 'call-1' }, unsupportedOutput);
    await plugin['tool.execute.before']?.({ tool: 'bash', sessionID: 'session', callID: 'call-2' }, invalidOutput);

    expect(unsupportedOutput.args.command).toBe('grep -R TODO .');
    expect(invalidOutput.args.command).toBe(123);
  });

  it('passes commands through unchanged when rewriting fails or yields no change', async () => {
    const failingShell = createShellMock({ throwOnRewrite: true }).shell;
    const unchangedShell = createShellMock().shell;
    const failingPlugin = await RtkOpenCodePlugin({ $: failingShell } as never);
    const unchangedPlugin = await RtkOpenCodePlugin({ $: unchangedShell } as never);
    const failingOutput = { args: { command: 'grep -R TODO .' } };
    const unchangedOutput = { args: { command: 'grep -R TODO .' } };

    await failingPlugin['tool.execute.before']?.(
      { tool: 'bash', sessionID: 'session', callID: 'call-1' },
      failingOutput,
    );
    await unchangedPlugin['tool.execute.before']?.(
      { tool: 'bash', sessionID: 'session', callID: 'call-2' },
      unchangedOutput,
    );

    expect(failingOutput.args.command).toBe('grep -R TODO .');
    expect(unchangedOutput.args.command).toBe('grep -R TODO .');
  });
});
