import { describe, expect, it } from 'vitest';

import { stripPrivateTags, truncate } from '../index.ts';

describe('Engram privacy helpers', () => {
  it('redacts private tags before sending content over HTTP', () => {
    expect(stripPrivateTags('safe <private>secret</private> text')).toBe('safe [REDACTED] text');
  });

  it('truncates long prompt content with an ellipsis', () => {
    expect(truncate('abcdef', 3)).toBe('abc...');
    expect(truncate('abc', 3)).toBe('abc');
  });
});
