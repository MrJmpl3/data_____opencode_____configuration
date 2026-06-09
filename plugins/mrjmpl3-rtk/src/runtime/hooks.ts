import { rewriteCommand } from './commands.ts';
import type { ShellExecutor } from './shell.ts';

interface ToolExecuteInput {
  tool?: unknown;
}

interface ToolExecuteOutput {
  args?: unknown;
}

const rewritableTools = new Set(['bash', 'shell']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createRtkHooks(shell: ShellExecutor) {
  return {
    'tool.execute.before': async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
      const tool = String(input.tool ?? '').toLowerCase();

      if (!rewritableTools.has(tool) || !isRecord(output.args)) {
        return;
      }

      const command = output.args.command;

      if (typeof command !== 'string' || command.length === 0) {
        return;
      }

      const rewritten = await rewriteCommand(shell, command);

      if (rewritten !== undefined) {
        output.args.command = rewritten;
      }
    },
  };
}
