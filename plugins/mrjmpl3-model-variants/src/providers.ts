import type { ModelVariants, ProviderEntry } from './types.ts';

export function normalizeProviderList(result: unknown): ProviderEntry[] {
  const data =
    typeof result === 'object' && result !== null && 'data' in result ? (result as { data?: unknown }).data : result;

  if (Array.isArray(data)) {
    return data as ProviderEntry[];
  }

  if (typeof data !== 'object' || data === null) {
    return [];
  }

  const record = data as { all?: unknown; providers?: unknown };

  if (Array.isArray(record.all)) {
    return record.all as ProviderEntry[];
  }

  if (Array.isArray(record.providers)) {
    return record.providers as ProviderEntry[];
  }

  return [];
}

export function extractModelVariants(providerList: ProviderEntry[]): ModelVariants {
  const variants: ModelVariants = {};

  for (const provider of providerList) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (model.variants && Object.keys(model.variants).length > 0) {
        variants[provider.id] = variants[provider.id] || {};
        variants[provider.id][modelId] = Object.keys(model.variants).sort();
      }
    }
  }

  return variants;
}
