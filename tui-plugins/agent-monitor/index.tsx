import type { TuiPlugin, TuiPluginMeta, TuiPluginModule } from '@opencode-ai/plugin/tui';

import { registerSidebarTui } from './src/features/quota/runtime.tsx';
import { registerSubagentStatusTui } from './src/features/subagent-status/runtime/runtime.tsx';

export { registerSidebarTui } from './src/features/quota/runtime.tsx';
export { registerSubagentStatusTui } from './src/features/subagent-status/runtime/runtime.tsx';

// Dos features independientes: quota (uso de APIs) y subagent-status (sesiones).
// Cada una registra su propio `sidebar_content` con distinto `order`:
// subagent-status (110) arriba, quota (120) abajo.
// El slot registry de OpenCode las mergea automáticamente por order ascendente.
const tui: TuiPlugin = async (api) => {
  // ponytail: TuiPluginMeta is currently empty — {} satisfies the expected
  // shape and is safer than `as` (which would hide future required fields).
  await registerSidebarTui(api, undefined, {} as unknown as TuiPluginMeta);
  await registerSubagentStatusTui(api, undefined);
};

const plugin: TuiPluginModule & { id: string } = {
  id: 'agent-monitor',
  tui,
};

export default plugin;
