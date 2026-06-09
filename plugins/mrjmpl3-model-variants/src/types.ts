export interface ProviderModel {
  variants?: Record<string, unknown>;
}

export interface ProviderEntry {
  id: string;
  models?: Record<string, ProviderModel>;
}

export type ModelVariants = Record<string, Record<string, string[]>>;

export interface ProviderListResult {
  data?: unknown;
}
