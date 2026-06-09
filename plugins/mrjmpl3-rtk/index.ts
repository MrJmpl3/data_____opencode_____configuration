import { RtkOpenCodePlugin } from './src/runtime/plugin.ts';

export { PLUGIN_ID, RtkOpenCodePlugin } from './src/runtime/plugin.ts';
export { commandExists, rewriteCommand } from './src/runtime/commands.ts';
export type { ShellCommand, ShellExecutor, ShellResult } from './src/runtime/shell.ts';

export default RtkOpenCodePlugin;
