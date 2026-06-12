import type { Plugin } from '@opencode-ai/plugin';

import { refreshSkillRegistry } from './skill-registry.ts';

export const SkillRegistryPlugin: Plugin = async ({ directory }) => {
  let refreshStarted = false;

  const refreshSkillRegistryOnce = async () => {
    if (refreshStarted) {
      return;
    }

    refreshStarted = true;
    await refreshSkillRegistry(directory);
  };

  return {
    'experimental.chat.system.transform': async () => {
      await refreshSkillRegistryOnce();
    },
  };
};

export default SkillRegistryPlugin;
