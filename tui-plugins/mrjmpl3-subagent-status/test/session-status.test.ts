import { describe, expect, it } from 'vitest';

import { deriveSessionStatus } from '../src/domain/session-status.ts';

describe('session status classification', () => {
  it('classifies structured running, terminal, and errored states consistently', () => {
    expect(deriveSessionStatus({ phase: 'queued' })).toBe('running');
    expect(deriveSessionStatus({ result: 'completed' })).toBe('done');
    expect(deriveSessionStatus({ error: { message: 'boom' } })).toBe('error');
  });

  it('does not treat idle as done', () => {
    expect(deriveSessionStatus('idle')).toBeUndefined();
    expect(deriveSessionStatus({ type: 'idle' })).toBeUndefined();
  });
});
