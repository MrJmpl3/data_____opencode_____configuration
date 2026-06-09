import { describe, expect, it } from 'vitest';

import { extractModelVariants, normalizeProviderList } from '../index.ts';

describe('model variant extraction', () => {
  it('normalizes OpenCode provider list shapes', () => {
    const providers = [{ id: 'openai', models: {} }];

    expect(normalizeProviderList({ data: { all: providers } })).toEqual(providers);
    expect(normalizeProviderList({ data: { providers } })).toEqual(providers);
    expect(normalizeProviderList({ data: providers })).toEqual(providers);
  });

  it('extracts sorted variant keys by provider and model', () => {
    const variants = extractModelVariants([
      {
        id: 'openai',
        models: {
          'gpt-5.5': { variants: { high: {}, low: {} } },
          plain: {},
        },
      },
    ]);

    expect(variants).toEqual({
      openai: {
        'gpt-5.5': ['high', 'low'],
      },
    });
  });
});
