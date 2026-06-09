import type { Plugin } from '@opencode-ai/plugin';

import { commandExists } from './commands.ts';
import { createRtkHooks } from './hooks.ts';

export const PLUGIN_ID = 'mrjmpl3-rtk';

export const RtkOpenCodePlugin: Plugin = async ({ $ }) => {
  if (!(await commandExists($))) {
    console.warn(`[${PLUGIN_ID}] rtk binary not found in PATH — plugin disabled`);

    return {};
  }

  return createRtkHooks($);
};

export default RtkOpenCodePlugin;
