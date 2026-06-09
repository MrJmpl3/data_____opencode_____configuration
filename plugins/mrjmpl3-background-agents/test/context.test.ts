import { describe, expect, it } from 'vitest';

import { formatDelegationContext } from '../index.ts';

describe('formatDelegationContext', () => {
  it('includes running delegations and polling guidance only when running work exists', () => {
    const context = formatDelegationContext(
      [{ id: 'swift-blue-fox', agent: 'explore', status: 'running', prompt: 'Inspect the codebase' }],
      [],
    );

    expect(context).toContain('## Running Delegations');
    expect(context).toContain('swift-blue-fox');
    expect(context).toContain('Do NOT poll `delegation_list`');
  });

  it('summarizes completed delegations with retrieval instructions', () => {
    const context = formatDelegationContext([], [{ id: 'quiet-green-owl', status: 'complete' }]);

    expect(context).toContain('## Recent Completed Delegations');
    expect(context).toContain('quiet-green-owl');
    expect(context).toContain('Use `delegation_read(id)`');
    expect(context).not.toContain('Do NOT poll `delegation_list`');
  });
});
