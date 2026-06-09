import { describe, expect, it } from 'vitest';

import { extractProjectName } from '../index.ts';

describe('extractProjectName', () => {
  it('falls back to the directory basename outside git repositories', () => {
    expect(extractProjectName('/tmp/example-project')).toBe('example-project');
  });
});
