import { describe, expect, it } from 'vitest';

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { renderMemory, memoryElements, memoryText, type MemoryNode } from '../../../support/opentui-memory-renderer.ts';
import type { QuotaLine } from '../../../../src/features/quota/domain/types.ts';
import { QuotaView } from '../../../../src/features/quota/ui/components/quota-view.tsx';

const api = {} as TuiPluginApi;

const render = (lines: readonly QuotaLine[], loading = false, nowMs = 1_000): string => {
  const { root, dispose } = renderMemory(() => QuotaView({ lines, loading, nowMs, api }) as unknown as MemoryNode);
  const text = memoryText(root);
  dispose();
  return text;
};

describe('QuotaView', () => {
  it('renders loading and no-data states', () => {
    expect(render([], true)).toBe('Loading…');
    expect(render([])).toBe('No data');
  });

  it('renders headings, details, windows, and pace lines', () => {
    const lines: QuotaLine[] = [
      { kind: 'heading', text: 'OpenAI' },
      { kind: 'window', label: 'Week', value: '30%', resetAtMs: 61_000, usedPct: 30 },
      { kind: 'pace', usedPct: 30, resetAtMs: 61_000, windowSeconds: 100 },
      { kind: 'detail', text: 'Healthy', tone: 'success' },
    ];

    expect(render(lines, false, 1_000)).toContain('● OpenAI');
    expect(render(lines, false, 1_000)).toContain('Week 30%');
    expect(render(lines, false, 1_000)).toContain('✓');
    expect(render(lines, false, 1_000)).toContain('Healthy');
  });

  it('marks an exhausted window group red', () => {
    const { root, dispose } = renderMemory(
      () =>
        QuotaView({
          lines: [
            { kind: 'heading', text: 'Provider' },
            { kind: 'window', label: 'Day', value: '100%', resetAtMs: 61_000, usedPct: 100 },
            { kind: 'detail', text: 'Exhausted', tone: 'neutral' },
          ],
          nowMs: 1_000,
          loading: false,
          api,
        }) as unknown as MemoryNode,
    );

    const textNodes = memoryElements(root, 'text');
    expect(textNodes.map((node) => node.props.fg)).toEqual(['white', 'red', 'red']);
    expect(memoryText(root)).toContain('Exhausted');
    dispose();
  });
});
