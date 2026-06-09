import type { Plugin } from '@opencode-ai/plugin';

import { writeVariantsCache } from './cache.ts';
import { extractModelVariants, normalizeProviderList } from './providers.ts';

export const ModelVariantsPlugin: Plugin = async (input) => {
  async function refreshVariantsCache(): Promise<void> {
    try {
      const result = await input.client.provider.list();
      const providerList = normalizeProviderList(result);
      const variants = extractModelVariants(providerList);

      await writeVariantsCache(variants);
    } catch (error) {
      console.error('[model-variants] cache refresh failed:', error);
    }
  }

  refreshVariantsCache().catch((error) => {
    console.error('[model-variants] unexpected refresh error:', error);
  });

  return {};
};

export default ModelVariantsPlugin;
